import { Component, OnInit } from '@angular/core';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'route-images-reader',
  templateUrl: './images-reader.component.html',
  styleUrls: ['./images-reader.component.scss']
})
export class ImagesReaderComponent implements OnInit {
  
  public production: boolean;

  constructor() {
    this.production = environment.production;
  }

  ngOnInit(): void {
    
  }

}
