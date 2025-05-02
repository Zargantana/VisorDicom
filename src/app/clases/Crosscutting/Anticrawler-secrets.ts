export enum AnticrawlerShore {
    BUZON = 'buzon'
}

export class AnticrawlerSecrets {
    private static secrets = '{ "key": "Aticus", "'+ AnticrawlerShore.BUZON +'": "' + 
        //btoa(String.fromCharCode(46, 7, 1, 22, 7, 18, 1, 19, 4, 2, 28, 31, 111, 23, 6, 14)) + 
        //btoa(String.fromCharCode(44, 21, 0, 15, 1, 28, 123, 27, 26, 11, 0, 1, 32, 52, 14, 14, 20, 26, 45, 90, 10, 12, 24)) + /*oshcrypeer*/
        //'", "toEncrypt": "' + 
        //btoa(String.fromCharCode(109, 97, 105, 108, 116, 111, 58, 122, 97, 114, 103, 97, 110, 116, 97, 110, 97, 46, 114, 101, 97, 100, 101, 114, 64, 103, 109, 97, 105, 108, 46, 99, 111, 109)) + /*zargantano*/
        btoa(String.fromCharCode(44, 21, 0, 15, 1, 28, 123, 14, 8, 17, 18, 18, 47, 0, 8, 13, 20, 93, 51, 17, 8, 7, 16, 1, 1, 19, 4, 2, 28, 31, 111, 23, 6, 14)) +
        //btoa('mailto:zargantana.reader@gmail.com') +
        '" }';

    public static getStringValue(key: string): string | undefined {
        const mySecrets = JSON.parse(this.secrets);
        return this.XOR(atob(mySecrets[key]));
    }

    public static XOR(xored: string): string {
        let unxored: string = '';
        const mySecrets = JSON.parse(this.secrets);
        let key: string = mySecrets['key'];
        for(let i = 0; i < xored.length; i++ ) {
            let keyIndex = i % key.length;
            unxored += String.fromCharCode(xored.charCodeAt(i) ^ key.charCodeAt(keyIndex));
        }
        return unxored;
    }

}