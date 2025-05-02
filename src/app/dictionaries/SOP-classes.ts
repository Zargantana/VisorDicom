import { Functions } from "../clases/Crosscutting/Functions";

export const SOPClass_dictionary = [
    ['1.2.840.10008.1.3.10','DICOMDIR']
];

export enum SOP_CLASS {
    DICOMDIR = 0
};

//TODO hacer un zingletone
export class SOPClass_Map extends Map<string, SOP_CLASS> {
    constructor() {
        super();
        for(let i = 0; i < SOPClass_dictionary.length; i++) {
            let SOPClass: SOP_CLASS = i;
            this.set(SOP_CLASS[i][0], SOPClass);
        }
    }
}

export class SOPClassTranslator {
    constructor(){
    }

    //Se repasa todos, así queda el más especializado.
    public static getName(identifier:string): string{
        let name = 'Unknown SOP Class';
        for (let i = 0; i < SOPClass_dictionary.length; i++) {
            //console.log('compare: ' + TX_dictionary[i][0] + ' with ' + identifier);
            if (identifier.includes(SOPClass_dictionary[i][0], 0)) {
                name = SOPClass_dictionary[i][1];
            }
        }
        return name;
    }

    public static isDICOMDIR(identifier:string): boolean{
        let clean = Functions.clearDCMImpairValue(identifier);
        return SOPClass_dictionary[0][0].includes(clean, 0);
    }
}