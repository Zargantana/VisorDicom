/*
 * Clasificación de un CD/carpeta con el MISMO código del visor (DCMFile → DCMFileReader → classifierDCM), sin
 * navegador: cuenta pacientes, estudios, modalidades, series e imágenes y captura la excepción, fichero a fichero,
 * si el clasificador revienta. Se empaqueta con esbuild desde classify_corpus.mjs.
 */
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { classifierDCM } from 'src/app/clases/Images/classifier-DCM.class';

export async function classifyAll(files: { name: string; bin: string }[]) {
  const classifier = new classifierDCM();
  const errors: { name: string; error: string }[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    try {
      const file = DCMFile.downloadedDCMFile(f.bin);
      await (file as any).inflateIfDeflated?.();   // Deflated Explicit VR LE, como hace el cargador del visor
      const reader = new DCMFileReader(file);
      if (!reader.readed_tags?.length) { skipped.push(f.name); continue; }
      classifier.ClassifyReader(reader);
    } catch (e: any) {
      errors.push({ name: f.name, error: String(e?.message ?? e) });
    }
  }
  let branchZeroError: string | undefined;
  try { classifier.SeriesBranchZero(); } catch (e: any) { branchZeroError = String(e?.message ?? e); }
  const tree = classifier.studySplit;
  const patients = tree.length;
  let studies = 0, modalities = 0, series = 0, images = 0;
  const empty: string[] = [];
  tree.forEach((p, pi) => {
    if (!p.length) empty.push(`paciente ${pi} sin estudios`);
    studies += p.length;
    p.forEach((s, si) => {
      if (!s.length) empty.push(`paciente ${pi} estudio ${si} sin modalidades`);
      modalities += s.length;
      s.forEach((m, mi) => {
        if (!m.length) empty.push(`paciente ${pi} estudio ${si} modalidad ${mi} sin series`);
        series += m.length;
        m.forEach((x, xi) => { if (!x.length) empty.push(`paciente ${pi} estudio ${si} modalidad ${mi} serie ${xi} vacía`); images += x.length; });
      });
    });
  });
  const patientIds = tree.map(p => p[0]?.[0]?.[0]?.[0]?.PatientId);
  return { patients, studies, modalities, series, images, patientIds, errors, skipped, empty, branchZeroError };
}
