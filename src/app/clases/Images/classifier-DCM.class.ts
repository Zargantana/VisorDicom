import { SOPClassTranslator } from "src/app/dictionaries/SOP-classes";
import { DCMFileReader } from "../DCM/DCM-file-reader.class";
import { DCMFile } from "../DCM/DCM-file.class";

export enum STUDYVIEW_LEVEL{
    Patients,
    Studies, 
    Modalities,
    Series
}

export class classifierDCM {
    public studySplit: DCMFileReader[][][][][] = []; //Patients / Studies / Modalities / Series 
    public modalitySplit: DCMFileReader[][][][][] = []; //Patients / Modalities / Studies / Series
    public lastSearchIndexFound: number = -1;

    public get numberOfImages(): number {
        let totalCount: number = 0;
        for(let pat = 0; pat < this.studySplit.length; pat++) {
            let patient = this.studySplit[pat];
            for(let std = 0; std < patient.length; std++) {
                let study = patient[std];
                for(let mod = 0; mod < study.length; mod++) {
                    let modality = study[mod];
                    for(let ser = 0; ser < modality.length; ser++) {
                        let serie = modality[ser];
                        totalCount += serie.length;
                    }
                }
            }
        }
        return totalCount;
    }

    public get numberOfSeries(): number {
        let totalCount: number = 0;
        for(let pat = 0; pat < this.studySplit.length; pat++) {
            let patient = this.studySplit[pat];
            for(let std = 0; std < patient.length; std++) {
                let study = patient[std];
                for(let mod = 0; mod < study.length; mod++) {
                    let modality = study[mod];
                    totalCount += modality.length;
                }
            }
        }
        return totalCount;
    }

    constructor() {
        
    }

    /**
     * Rama con solo la primera serie. Si aun no hay ninguna imagen clasificada (p. ej. el primer fichero leido de un
     * CD es el DICOMDIR, que no se clasifica), devuelve un clasificador vacio en vez de reventar.
     */
    public SeriesBranchZero(): classifierDCM {
        let result: classifierDCM = new classifierDCM();
        const firstSerie = this.studySplit[0]?.[0]?.[0]?.[0];
        if (!firstSerie) {
            return result;
        }

        let patient = result.pushPatient(result.studySplit);
        const emptyStudy: DCMFileReader[][][] = [];
        patient.push(emptyStudy);
        const emptyModality: DCMFileReader[][] = [];
        emptyStudy.push(emptyModality);
        emptyModality.push(firstSerie);

        return result;
    }

    public SeriesBranchByImageUID(SOPInstanceUID: string): classifierDCM | null{
        /*let result: classifierDCM | null = null;
        let serieFound = false;

        for(let pat = 0; pat < this.studySplit.length; pat++) {
            let patient = this.studySplit[pat];
            for(let std = 0; std < patient.length; std++) {
                let study = patient[std];
                for(let mod = 0; mod < study.length; mod++) {
                    let modality = study[mod];
                    for(let ser = 0; ser < modality.length; ser++) {
                        let serie = modality[ser];
                        for(let img = 0; img < serie.length; img++) {
                            if (serie[img].SOPInstanceUID == SOPInstanceUID) {
                                serieFound = true;
                                break;
                            }
                        }
                        if (serieFound) {
                            result = new classifierDCM();
                            let patient = result.pushPatient(result.studySplit);
                            const emptyStudy: DCMFileReader[][][] = [];
                            patient.push(emptyStudy);
                            const emptyModality: DCMFileReader[][] = [];
                            emptyStudy.push(emptyModality);
                            emptyModality.push(serie);
                            return result;
                        }
                    }
                }
            }
        }
        return result;*/
        return this.branchByImageUID(SOPInstanceUID, STUDYVIEW_LEVEL.Series);
    }

    public ModalityBranchByImageUID(SOPInstanceUID: string): classifierDCM | null{
        return this.branchByImageUID(SOPInstanceUID, STUDYVIEW_LEVEL.Modalities);
    }

    public StudyBranchByImageUID(SOPInstanceUID: string): classifierDCM | null{
        return this.branchByImageUID(SOPInstanceUID, STUDYVIEW_LEVEL.Studies);
    }

    public PatientBranchByImageUID(SOPInstanceUID: string): classifierDCM | null{
        return this.branchByImageUID(SOPInstanceUID, STUDYVIEW_LEVEL.Patients);
    }

    private branchByImageUID(SOPInstanceUID: string, level: STUDYVIEW_LEVEL): classifierDCM | null{
        let result: classifierDCM | null = null;
        let imageFound = false;

        for(let pat = 0; pat < this.studySplit.length; pat++) {
            let patient = this.studySplit[pat];
            for(let std = 0; std < patient.length; std++) {
                let study = patient[std];
                for(let mod = 0; mod < study.length; mod++) {
                    let modality = study[mod];
                    for(let ser = 0; ser < modality.length; ser++) {
                        let serie = modality[ser];
                        for(let img = 0; img < serie.length; img++) {
                            if (serie[img].SOPInstanceUID == SOPInstanceUID) {
                                imageFound = true;
                                break;
                            }
                        }
                        if (imageFound) {
                            result = new classifierDCM();

                            if (level == STUDYVIEW_LEVEL.Patients) {
                                result.studySplit.push(patient);
                                return result;
                            }
                            const emptyPatient = result.pushPatient(result.studySplit);
                            if (level == STUDYVIEW_LEVEL.Studies) {
                                emptyPatient.push(study);
                                return result;
                            } 
                            const emptyStudy: DCMFileReader[][][] = [];
                            emptyPatient.push(emptyStudy);
                            if (level == STUDYVIEW_LEVEL.Modalities) {
                                emptyStudy.push(modality);
                            }
                            if (level == STUDYVIEW_LEVEL.Series) {
                                const emptyModality: DCMFileReader[][] = [];
                                emptyStudy.push(emptyModality);
                                emptyModality.push(serie);
                            }
                            return result;
                        }
                    }
                }
            }
        }
        return result;
    }

    public searchImageByUID(SOPInstanceUID: string): DCMFileReader | undefined {
        this.lastSearchIndexFound = 0;
        for(let pat = 0; pat < this.studySplit.length; pat++) {
            let patient = this.studySplit[pat];
            for(let std = 0; std < patient.length; std++) {
                let study = patient[std];
                for(let mod = 0; mod < study.length; mod++) {
                    let modality = study[mod];
                    for(let ser = 0; ser < modality.length; ser++) {
                        let serie = modality[ser];
                        for(let img = 0; img < serie.length; img++) {
                            if (serie[img].SOPInstanceUID == SOPInstanceUID) {
                                return serie[img];
                            }
                            this.lastSearchIndexFound++;
                        }
                    }
                }
            }
        }
        this.lastSearchIndexFound = -1;
        return undefined;
    }

    public searchImageByIndex(index: number): DCMFileReader | undefined {
        let searching = 0;
        for(let pat = 0; pat < this.studySplit.length; pat++) {
            let patient = this.studySplit[pat];
            for(let std = 0; std < patient.length; std++) {
                let study = patient[std];
                for(let mod = 0; mod < study.length; mod++) {
                    let modality = study[mod];
                    for(let ser = 0; ser < modality.length; ser++) {
                        let serie = modality[ser];
                        for(let img = 0; img < serie.length; img++) {
                            if (searching == index) {
                                return serie[img];
                            }
                            searching++;
                        }
                    }
                }
            }
        }
        return undefined;
    }

    public Classify(unclassified: DCMFile[], start: number = 0, end: number = 65535) {
        let reader: DCMFileReader;
        
        for (let img = start; (img < unclassified.length || img < end); img++)
        {
            reader = new DCMFileReader(unclassified[img]);

            this.ClassifyReader(reader);
        }
    }

    public ClassifyDownloaded(unclassified: DCMFile[], start: number = 0, end: number = 65535) {
      let reader: DCMFileReader;
      
      for (let img = start; (img < unclassified.length || img < end); img++)
      {
          reader = new DCMFileReader(unclassified[img]);
          reader.uploaded = true;
          this.ClassifyReader(reader);
      }
  }

    public ClassifyReader(reader: DCMFileReader) {
      let studySplitPatient: DCMFileReader[][][][];
      let modalitySplitPatient: DCMFileReader[][][][];
      let studySplitStudy: DCMFileReader[][][];
      let modalitySplitModality: DCMFileReader[][][];
      let studySplitModality: DCMFileReader[][];
      let modalitySplitStudy: DCMFileReader[][];
      let studySplitSerie: DCMFileReader[];
      let modalitySplitSerie: DCMFileReader[];

      // Sin SOP Class (ni en 0002 ni en 0008: ACR-NEMA 1.0) solo entra si trae imagen; el DICOMDIR nunca
      const hasSopClass = !!reader.SOPClass.replace(/\0/g, '').trim();
      if (!SOPClassTranslator.isDICOMDIR(reader.SOPClass) && (hasSopClass || reader.Rows > 0)) {
        studySplitPatient = this.searchPatient(this.studySplit, reader.PatientId);
        studySplitStudy =  this.searchStudySplitStudy(studySplitPatient, reader);
        studySplitModality = this.searchStudySplitModality(studySplitStudy, reader);
        studySplitSerie = this.searchSerie(studySplitModality, reader);
        this.insertImageInOrderedPosition(reader, studySplitSerie);

        modalitySplitPatient = this.searchPatient(this.modalitySplit, reader.PatientId);
        modalitySplitModality =  this.searchModalitySplitModality(modalitySplitPatient, reader);
        modalitySplitStudy = this.searchModalitySplitStudy(modalitySplitModality, reader);
        modalitySplitSerie = this.searchSerie(modalitySplitStudy, reader);
        this.insertImageInOrderedPosition(reader, modalitySplitSerie);
      }
    }

    private searchPatient(patients: DCMFileReader[][][][][], patientId: string): DCMFileReader[][][][] {
        for(let pat = 0; pat < patients.length; pat++) {
            if (classifierDCM.normId(patients[pat][0]?.[0]?.[0]?.[0]?.PatientId) == classifierDCM.normId(patientId)) {
                return patients[pat];
            }
        }
        return this.insertNewPatientInOrderedPosition(patientId, patients);
    }

    /**
     * Mismo estudio: por Study Instance UID. Solo si NINGUNO de los dos lo trae (ACR-NEMA 1.0, datasets sin UIDs) se
     * recurre a la fecha. Antes se exigian las dos cosas y los estudios reales cuyas imagenes no llevan todas la misma
     * Study Date salian partidos; y despues bastaba con que faltara en uno, asi que un estudio empezado por un fichero
     * sin UID se tragaba otros estudios distintos del mismo dia (ficheros de prueba de pydicom: 45 estudios frente a 51).
     */
    private static sameStudy(a: DCMFileReader, b: DCMFileReader): boolean {
        const uidA = classifierDCM.normId(a.StudyInstanceUID), uidB = classifierDCM.normId(b.StudyInstanceUID);
        if (uidA || uidB) {
            return uidA == uidB;
        }
        return classifierDCM.normId(a.StudyDate) == classifierDCM.normId(b.StudyDate);
    }

    /** Identificadores sin el relleno (NUL de los UID impares, espacios de LO/SH): el mismo valor escrito por dos equipos. */
    private static normId(value: string | undefined | null): string {
        return (value ?? '').replace(/\0/g, '').trim();
    }

    private searchStudySplitStudy(studies: DCMFileReader[][][][], reader: DCMFileReader): DCMFileReader[][][] {
        for(let std = 0; std < studies.length; std++) {
            const study = studies[std];
            for(let mod = 0; mod < study.length; mod++) {
                const modality = study[mod];
                for(let ser = 0; ser < modality.length; ser++) {
                    const serie = modality[ser];
                    if (classifierDCM.sameStudy(serie[0], reader)) {
                        return study;
                    }
                }
            }
        }
        return this.insertNewStudySplitStudyInOrderedPosition(reader, studies);
    }

    private searchStudySplitModality(modalities: DCMFileReader[][][], reader: DCMFileReader): DCMFileReader[][] {
        for(let mod = 0; mod < modalities.length; mod++) {
            const modality = modalities[mod];
            if (classifierDCM.normId(modality[0][0].Modality) == classifierDCM.normId(reader.Modality)) {
                    return modality;
            }
        }
        const emptyModality: DCMFileReader[][] = [];
        modalities.push(emptyModality);
        return emptyModality;
    }

    private searchModalitySplitModality(modalities: DCMFileReader[][][][], reader: DCMFileReader): DCMFileReader[][][] {
        for(let mod = 0; mod < modalities.length; mod++) {
            const modality = modalities[mod];
            if (classifierDCM.normId(modality[0][0][0].Modality) == classifierDCM.normId(reader.Modality)) {
                return modality;
            }
        }
        const emptyModality: DCMFileReader[][][] = [];
        modalities.push(emptyModality);
        return emptyModality;
    }

    private searchModalitySplitStudy(studies: DCMFileReader[][][], reader: DCMFileReader): DCMFileReader[][] {
        for(let std = 0; std < studies.length; std++) {
            const study = studies[std];
            for(let ser = 0; ser < study.length; ser++) {
                const serie = study[ser];
                if (classifierDCM.sameStudy(serie[0], reader)) {
                    return study;
                }
            }
        }
        const emptyStudy: DCMFileReader[][] = [];
        //TODO: Ordered insert in the list of studies
        studies.push(emptyStudy);
        return emptyStudy;
    }

    private searchSerie(series: DCMFileReader[][], reader: DCMFileReader): DCMFileReader[] {
        for(let ser = 0; ser < series.length; ser++) {
            const serie = series[ser];
            if (classifierDCM.normId(serie[0].SeriesInstanceUID) == classifierDCM.normId(reader.SeriesInstanceUID)) {
                return serie;
            }
        }
        return this.insertNewSerieInOrderedPosition(reader, series);
    }

    private pushPatient(array: DCMFileReader[][][][][]): DCMFileReader[][][][] {
        let patient: DCMFileReader[][][][] = [];
        array.push(patient);
        return patient;
    }

    private insertNewPatientInOrderedPosition(newPatientId: string, array: DCMFileReader[][][][][]): DCMFileReader[][][][]{
        let patient: DCMFileReader[][][][] = [];
        for(let i = 0; i < array.length; i++) {
            if (newPatientId < array[i][0][0][0][0].PatientId) {
                array.splice(i,0,patient);
                return patient;
            }
        }
        array.push(patient);
        return patient;
    }

    private insertNewStudySplitStudyInOrderedPosition(newPatient: DCMFileReader, array: DCMFileReader[][][][]): DCMFileReader[][][] {
        let study: DCMFileReader[][][] = [];
        for(let i = 0; i < array.length; i++) {
            if (newPatient.StudyDate < array[i][0][0][0].StudyDate) {
                array.splice(i,0,study);
                return study;
            }
        }
        array.push(study);
        return study;
    }

    private insertNewSerieInOrderedPosition(newSerie: DCMFileReader, array: DCMFileReader[][]): DCMFileReader[] {
        let serie: DCMFileReader[] = [];
        for(let i = 0; i < array.length; i++) {
            if (newSerie.SeriesNumber < array[i][0].SeriesNumber) {
                array.splice(i,0,serie);
                return serie;
            }
        }
        array.push(serie);
        return serie;
    }

    private insertImageInOrderedPosition(newImage: DCMFileReader, serie: DCMFileReader[]) {
        for(let i = 0; i < serie.length; i++) {
            if (newImage.InstanceNumber < serie[i].InstanceNumber) {
                serie.splice(i,0,newImage);
                return;
            }
        }
        serie.push(newImage);
    }

    public getArray(): DCMFileReader[] {
      let images: DCMFileReader[] = [];
      for (let pat = 0; pat < this.studySplit.length; pat++) {
        let patient = this.studySplit[pat];
        for (let std = 0; std < patient.length; std++) {
          let study = patient[std];
          for (let mod = 0; mod < study.length; mod++) {
            let modality = study[mod];
            for (let ser = 0; ser < modality.length; ser++) {
              let serie = modality[ser];
              images = images.concat(serie);
            }
          }
        }
      }
      return images;
    }
}