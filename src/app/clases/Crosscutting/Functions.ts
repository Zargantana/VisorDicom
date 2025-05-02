export enum PATIENT_SEX {
  UNKNOWN = 0,
  HOMBRE = 1,
  MUJER = 2,
  OTRO = 3
}

export abstract class Functions {
  public  static pad(num:number, size:number): string {
    let s = num+'';
    while (s.length < size) s = '0' + s;
    return s;
  }


    public static getDatePickerDate(bdate: Date): string {
      let year: string = this.pad(bdate.getUTCFullYear(),4);
      let month: string = this.pad(bdate.getUTCMonth()+1,2);
      let day: string = this.pad(bdate.getUTCDate(),2);

      const result: string = year + '-' + month + '-' + day;
      return result;
    }

    public static getDatePickerValue(bdate: string): Date {
      /*let year: string = bdate.substring(0,4);
      let month: string = bdate.substring(0,4);
      let day: string = bdate.substring(0,4);*/

      const result: Date = new Date(bdate);
      return result;
    }

    public static clearDCMImpairValue(value: string): string {
        if ((value.length % 2 == 0) && (value.charCodeAt(value.length - 1) == 0x00)) {
            return value.substring(0, value.length - 1);
        }
        return value;
    }

    public static getDCMDate(dcmDate: string): Date {
      let result: Date;

      const year: string = dcmDate.substring(0,4);
      const month: string= dcmDate.substring(4, 6);
      const day: string= dcmDate.substring(6, 8);
      
      result = new Date(Date.UTC(+year,(+month)-1,+day));

      return result;
    }

    public static getDCMSex(dcmSex: string): PATIENT_SEX {
      let result: PATIENT_SEX;

      switch(this.clearDCMImpairValue(dcmSex)) {
        case 'M': { result = PATIENT_SEX.HOMBRE; break; }
        case 'F': { result = PATIENT_SEX.MUJER; break; }
        case 'O': { result = PATIENT_SEX.OTRO; break; }
        default:
          result = PATIENT_SEX.UNKNOWN;
      }

      return result;
    }

    public static uncomplement(val: number, bitWidth: number): number {
        const isNegative = val & (1 << (bitWidth - 1));
        const boundary = 1 << bitWidth;
        const minVal = -boundary;
        const mask = boundary - 1;
    
        return isNegative ? minVal + (val & mask) : val;
    }

    public static getValueAs2ByteNumber(value: string, LE: boolean): number {
        return value.charCodeAt(LE?1:0) * 256 + value.charCodeAt(LE?0:1);
    }

    public static MyHash(toHash: string): string {
        /*var CryptoJS = require("crypto-js");
        return CryptoJS.MD5(toHash).toString();*/
        let finalcode: number[] = [];
        let finalhash: string = '';
        let word: number[][] = [];
        let roundIndex: number = 0;
        
        for(let wordlength = 0; wordlength < 8; wordlength++) {
            for(let words = 0; words < 64; words++) {
                if (wordlength == 0) {
                    word.push([toHash.charCodeAt(roundIndex)]);
                } else {
                    word[words].push(toHash.charCodeAt(roundIndex));
                }
                roundIndex = ((++roundIndex) % toHash.length);
            }
        }

        for(let words = 0; words < 64; words++) {
            finalcode.push(0);
            for(let wordlength = 0; wordlength < 8; wordlength++) {
                finalcode[words] = (finalcode[words] ^ word[words][wordlength]);
            }
            finalhash += String.fromCharCode(finalcode[words]);
        }
        
        return btoa(finalhash);
    }
}