import { Component, OnInit } from '@angular/core';
import { AnticrawlerSecrets, AnticrawlerShore } from 'src/app/clases/Crosscutting/Anticrawler-secrets';
import { ThemeService } from 'src/app/services/theme.service';

@Component({
  selector: 'mail-sender',
  templateUrl: './mail-sender.component.html',
  styleUrls: ['./mail-sender.component.scss']
})
export class MailSenderComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
  }

  public isDark(): boolean {
    return (ThemeService.current === 'dark');
  }

  public Emilio() {
    const emilio = AnticrawlerSecrets.getStringValue(AnticrawlerShore.BUZON);
    if (emilio) {
      var link=document.createElement("a");       
      link.href = emilio + '?subject=Comentario, sugerencia o solicitud!&body=Hola, quiero comentar algo...!';
      link.click();
    }
  }

}
