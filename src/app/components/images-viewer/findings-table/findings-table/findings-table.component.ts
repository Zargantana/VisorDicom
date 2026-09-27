import { Component, EventEmitter, Input, Output } from '@angular/core';
import { classifierDCM } from 'src/app/clases/Images/classifier-DCM.class';
import { DCMFileReader } from 'src/app/clases/DCM/DCM-file-reader.class';
import { I18n } from 'src/app/i18n/i18n';
import { ThemeService } from 'src/app/services/theme.service';

/** Una fila de la tabla = una serie. Los spans agrupan visualmente paciente, estudio y modalidad (rowspan). */
export interface FindingRow {
  key: string;
  /** SOP Instance UID de la primera imagen de la serie: sirve para localizar cualquier nivel del árbol */
  uid: string;
  patientSpan: number;
  studySpan: number;
  modalitySpan: number;
  patientId: string;
  patientName: string;
  patientTitle: string;
  studyDate: string;
  studyDescription: string;
  modality: string;
  seriesNumber: string;
  seriesDescription: string;
  seriesTitle: string;
  count: number;
}

/**
 * Tabla de hallazgos: el árbol paciente → estudio → modalidad → serie → imágenes del clasificador como una tabla
 * plana (una fila por serie, rowspan en los niveles superiores), con columnas fijas, textos largos recortados con
 * puntos suspensivos y tooltip, y fechas legibles. Se usa en el visor (rama seleccionada y árbol completo) y en el
 * cargador (selector en vivo). Pulsar una celda abre el visor en ese nivel.
 */
@Component({
    selector: 'findings-table',
    templateUrl: './findings-table.component.html',
    styleUrls: ['./findings-table.component.scss'],
    standalone: false
})
export class FindingsTableComponent {

  @Input() classifier: classifierDCM | undefined;

  @Output() reviewPatientClick = new EventEmitter<string>();
  @Output() reviewStudyClick = new EventEmitter<string>();
  @Output() reviewModalityClick = new EventEmitter<string>();
  @Output() reviewImageClick = new EventEmitter<string>();

  private cacheKey = '';
  private cachedRows: FindingRow[] = [];

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  /** Filas de la tabla; se recalculan solo cuando el árbol cambia (llegan imágenes o series nuevas). */
  public get rows(): FindingRow[] {
    const c = this.classifier;
    if (!c) {
      return [];
    }
    // El idioma forma parte de la clave: los tooltips ("Serie 3 · 12 imágenes") se rehacen al cambiarlo
    const key = `${c.studySplit.length}/${c.numberOfSeries}/${c.numberOfImages}/${I18n.current}`;
    if (key === this.cacheKey) {
      return this.cachedRows;
    }
    const rows: FindingRow[] = [];
    for (const patient of c.studySplit) {
      const patientSeries = patient.reduce((n, study) => n + study.reduce((m, modality) => m + modality.length, 0), 0);
      let firstOfPatient = true;
      for (const study of patient) {
        const studySeries = study.reduce((m, modality) => m + modality.length, 0);
        let firstOfStudy = true;
        for (const modality of study) {
          let firstOfModality = true;
          for (const serie of modality) {
            const img = serie[0];
            if (!img) {
              continue;
            }
            rows.push(this.rowOf(img, serie.length, firstOfPatient ? patientSeries : 0, firstOfStudy ? studySeries : 0,
              firstOfModality ? modality.length : 0, rows.length));
            firstOfPatient = firstOfStudy = firstOfModality = false;
          }
        }
      }
    }
    this.cacheKey = key;
    this.cachedRows = rows;
    return rows;
  }

  private rowOf(img: DCMFileReader, count: number, patientSpan: number, studySpan: number, modalitySpan: number, index: number): FindingRow {
    const patientId = FindingsTableComponent.clean(img.PatientId);
    const patientName = FindingsTableComponent.personName(img.PatientName);
    const seriesDescription = FindingsTableComponent.clean(img.SeriesDescription);
    const seriesNumber = (img.SeriesNumber || img.SeriesNumber === 0) && !isNaN(img.SeriesNumber) ? String(img.SeriesNumber) : '';
    return {
      key: img.SOPInstanceUID || `fila-${index}`,
      uid: img.SOPInstanceUID,
      patientSpan, studySpan, modalitySpan,
      patientId: patientId || I18n.t('table.noId'),
      patientName,
      patientTitle: [patientId, patientName].filter(Boolean).join(' · '),
      studyDate: FindingsTableComponent.formatDate(img.StudyDate),
      studyDescription: FindingsTableComponent.clean(img.StudyDescription),
      modality: FindingsTableComponent.clean(img.Modality),
      seriesNumber,
      seriesDescription,
      seriesTitle: [seriesNumber ? I18n.t('table.seriesWord') + ' ' + seriesNumber : '', seriesDescription,
        `${count} ${I18n.t(count == 1 ? 'table.image.one' : 'table.image.many')}`].filter(Boolean).join(' · '),
      count,
    };
  }

  private static clean(value: string | undefined | null): string {
    return (value ?? '').replace(/\0/g, '').trim();
  }

  /**
   * PN "Apellidos^Nombre^Segundo" -> "Apellidos Nombre Segundo" (sin los separadores del estándar). Con varios grupos
   * ("Yamada^Tarou=山田^太郎=やまだ^たろう": alfabético, ideográfico, fonético), el primero que no esté vacío.
   */
  private static personName(value: string | undefined | null): string {
    const groups = FindingsTableComponent.clean(value).split('=')
      .map(g => g.split('^').map(p => p.trim()).filter(Boolean).join(' '));
    return groups.find(Boolean) ?? '';
  }

  /** DA "AAAAMMDD" -> "DD/MM/AAAA"; cualquier otra cosa se enseña tal cual. */
  private static formatDate(value: string | undefined | null): string {
    const v = FindingsTableComponent.clean(value);
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
  }

  public ReViewImage(event: any, SOPInstanceUID: string) {
    this.reviewImageClick.emit(SOPInstanceUID);
    event.stopPropagation();
  }

  public ReViewModality(event: any, SOPInstanceUID: string) {
    this.reviewModalityClick.emit(SOPInstanceUID);
    event.stopPropagation();
  }

  public ReViewStudy(event: any, SOPInstanceUID: string) {
    this.reviewStudyClick.emit(SOPInstanceUID);
    event.stopPropagation();
  }

  public ReViewPatient(event: any, SOPInstanceUID: string) {
    this.reviewPatientClick.emit(SOPInstanceUID);
    event.stopPropagation();
  }
}
