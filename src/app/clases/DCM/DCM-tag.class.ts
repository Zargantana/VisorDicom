import { DCMTagBase } from "./DCM-tag-base.class";

export class DCMTag extends DCMTagBase {

    public setVL(raw: string, LE: boolean): void {
        this.VL = raw.charCodeAt(LE?1:0) * 256 + raw.charCodeAt(LE?0:1);
    }

    public setVL32(raw: string, LE: boolean): void {
        this.VL = (raw.charCodeAt(LE?3:2) * 256 + raw.charCodeAt(LE?2:3)) * 256 * 256;
        this.VL += raw.charCodeAt(LE?1:0) * 256 + raw.charCodeAt(LE?0:1);
    }

    public setTag(raw: string, LE: boolean) {
        this.TagHigh = raw.charCodeAt(LE?1:0) * 256 + raw.charCodeAt(LE?0:1);
        this.TagLow = raw.charCodeAt(LE?3:2) * 256 + raw.charCodeAt(LE?2:3);
    }

    public getValueAs2ByteNumber(LE: boolean): number {
        return this.Value?(this.Value.charCodeAt(LE?1:0) * 256 + this.Value.charCodeAt(LE?0:1)):0;
    }

    public getValueAsNumString(): number {
        return this.Value?parseInt(this.Value):0;
    }

    private debugThoseBytes(raw: string): void{
        var bytes: number[] = []; // char codes
        var bytesv2: number[] = []; // char codes
        for (var i = 0; i < raw.length; ++i) {
            var code = raw.charCodeAt(i);
            bytes = bytes.concat([code]);
            bytesv2 = bytesv2.concat([code & 0xff, code / 256 >>> 0]);
        }
        console.log('bytes', bytes.join(', '));
        console.log('bytesv2', bytesv2.join(', '));
    }


}