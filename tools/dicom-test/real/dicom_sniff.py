"""¿Reconoce el cargador del visor este fichero como DICOM? Misma regla que DCMFile.datasetOffset / sniffDataset
(src/app/clases/DCM/DCM-file.class.ts): "DICM" en el byte 128; o "DICM" al principio sin preámbulo; o, sin nada, un
dataset que se deja leer en sus primeros 2 KB (primer grupo 0000, 0002 u 0008, etiquetas crecientes, VR válidas y
longitudes que caben; tres elementos, o dos si el siguiente ya no cabe). Si cambia allí, cambia aquí."""
from __future__ import annotations

from typing import Optional

HEAD_BYTES = 2048
LONG_VRS = {b"OB", b"OD", b"OF", b"OL", b"OV", b"OW", b"SQ", b"SV", b"UC", b"UN", b"UR", b"UT", b"UV"}
VRS = {v.encode() for v in ("AE AS AT CS DA DS DT FD FL IS LO LT OB OD OF OL OV OW PN SH SL SQ SS ST SV TM UC UI UL UN "
                            "UR US UT UV").split()}


def _parses_as(raw: bytes, start: int, explicit: bool, le: bool) -> bool:
    def u16(at: int) -> int:
        return int.from_bytes(raw[at:at + 2], "little" if le else "big")

    def u32(at: int) -> int:
        return int.from_bytes(raw[at:at + 4], "little" if le else "big")

    pos, count, last = start, 0, -1
    while pos + 8 <= len(raw):
        if int.from_bytes(raw[pos:pos + 2], "little") == 0x0002 and not le:
            return False
        group, element = u16(pos), u16(pos + 2)
        if count == 0 and group not in (0x0000, 0x0002, 0x0008):
            return False
        if count > 0 and (last >> 16) == 0x0002 and group != 0x0002:
            return count >= 2
        tag = (group << 16) | element
        if tag <= last or group == 0xFFFE:
            return False
        header = 8
        if explicit:
            vr = raw[pos + 4:pos + 6]
            if vr not in VRS:
                return False
            if vr in LONG_VRS:
                if pos + 12 > len(raw):
                    break
                length, header = u32(pos + 8), 12
            else:
                length = u16(pos + 6)
        else:
            length = u32(pos + 4)
        count += 1
        last = tag
        if length == 0xFFFFFFFF:
            return count >= 2
        if length > 0x7FFFFFFF:
            return False
        pos += header + length
        if count >= 3:
            return True
    return count >= 2 and pos >= len(raw)


def dataset_offset(head: bytes) -> Optional[int]:
    """132, 4, 0 o None (no es DICOM para el visor). `head`: los primeros HEAD_BYTES del fichero."""
    if len(head) >= 132 and head[128:132] == b"DICM":
        return 132
    for start in ((4,) if head[:4] == b"DICM" else ()) + (0,):
        if any(_parses_as(head, start, e, le) for le in (True, False) for e in (True, False)):
            return start
    return None
