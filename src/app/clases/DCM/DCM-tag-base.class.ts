export abstract class DCMTagBase {
    public TagHigh: number | undefined;
    public TagLow: number | undefined;
    public VR: string | undefined;
    public VL: number | undefined;
    public Value: string | undefined;
    public position: number | undefined;
    public dataOffset: number | undefined;
    public WarningFlag: boolean = false;
    /** Nivel de anidamiento en el que se leyo el tag (0 = dataset raiz). Lo fija DCMFileReader. */
    public depth: number = 0;

    constructor(){
        
    }
}