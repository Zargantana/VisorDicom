import { Component } from '@angular/core';
import { DCMFile } from 'src/app/clases/DCM/DCM-file.class';

@Component({
  selector: 'app-dir-loader',
  templateUrl: './dir-loader.component.html',
  styleUrls: ['./dir-loader.component.scss'],
  host: {
        class:'d-flex slab-flex-1 flex-column m-0 p-0'
  }
})
export class DirLoaderComponent {

  public foundDCMFiles: DCMFile[] = [];
  
  constructor() { }
}

