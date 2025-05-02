import { Component } from '@angular/core';
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';

@Component({
  selector: 'app-file-loader',
  templateUrl: './file-loader.component.html',
  styleUrls: ['./file-loader.component.scss'],
  host: {
    class:'d-flex slab-flex-1 flex-column m-0 p-0'
  }
})
export class FileLoaderComponent {

  public foundDCMFiles: DCMFile[] = [];

  constructor() { }

}
