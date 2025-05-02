import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter, RescaleParameters, VOIData, VOIFunction } from "../DCM/DCM-interpreter.class";

export abstract class BaseColor {
    protected bytesPerPixel: number;
    protected interpret: DCMInterpreter;
    protected VOIwindow: VOIData;
    protected RescaleParams: RescaleParameters;
    private ranges: number[] = [];
    private slides: number[] = [];

    constructor(protected reader: DCMFileReader) {
        this.bytesPerPixel = reader.BitsAllocated / 8;
        this.interpret = new DCMInterpreter(reader);
        this.RescaleParams = this.interpret.getRescaleParameters();
        this.VOIwindow = this.interpret.getVOIData();
        for (let i = 0; i < this.VOIwindow.WindowWidth.length; i++) {
            this.ranges.push(this.VOIwindow.WindowWidth[i] >> 1);
            let slide = this.VOIwindow.WindowCenter[i] - this.ranges[i];
            //slide = slide<0?0:slide;
            this.slides.push(slide);
        }
    }

    public pixelDataTo32BitBuffer(data: Uint8ClampedArray, pixelData: any) {
        if ((pixelData instanceof ArrayBuffer) 
            || (pixelData instanceof Uint8Array) || (pixelData instanceof Uint16Array)
            || (pixelData instanceof Int8Array) || (pixelData instanceof Int16Array)) {
            this.pixelDataBufferTo32BitBuffer(data, pixelData);
        } else {
            this.pixelDataStringTo32BitBuffer(data, pixelData);
        }
    }

    protected abstract pixelDataStringTo32BitBuffer(data: Uint8ClampedArray, pixelData: string): void;
    protected abstract pixelDataBufferTo32BitBuffer(data: Uint8ClampedArray, buffer: any): void;

    //TODO: Otra aproximación más rapida es hacer el mapping de todos los valores posibles de pixel a su valor ya VOIluteado. Así, pasamos por la tabla solo en plan valor = TABLA[elquebusco];
    protected applyVOIWindow(pixel: number, selected: number, VOIfunc: VOIFunction): number {
        let distance = pixel - this.VOIwindow.WindowCenter[selected];
        
        if (Math.abs(distance) >= this.ranges[selected]) {
            return (distance>0)?0xFF:0;
        } else {
            if (VOIfunc == VOIFunction.LINEAR) {
                //return ((pixel - this.slides[selected]) * 255) / this.VOIwindow.WindowWidth[selected];
                return ((pixel - this.slides[selected]) * 255) / this.VOIwindow.WindowWidth[selected];
            } else {
                //TODO: change to apropiate function.
                //return ((pixel - this.slides[selected]) * 255) / this.VOIwindow.WindowWidth[selected];
                return ((pixel - this.slides[selected]) * 255) / this.VOIwindow.WindowWidth[selected];
            }
        }
    }

    protected applyRescale(pixel: number): number {
        return (pixel * this.RescaleParams.Slope) + this.RescaleParams.Intercept;
    }
}
