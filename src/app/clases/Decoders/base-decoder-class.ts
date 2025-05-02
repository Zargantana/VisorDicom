import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMInterpreter } from "../DCM/DCM-interpreter.class";

export abstract class BaseDecoder {
    protected interpret: DCMInterpreter;

    constructor(protected reader: DCMFileReader) {
        this.interpret = new DCMInterpreter(reader);
    }

    public abstract Decode(): any[];
}