export abstract class DCMTagBase {
    public TagHigh: number | undefined;
    public TagLow: number | undefined;
    public VR: string | undefined;
    public VL: number | undefined;
    public Value: string | undefined;
    public position: number | undefined;
    public dataOffset: number | undefined;
    public WarningFlag: boolean = false;

    constructor(){
        
    }
}