import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/** Título, descripción, canonical y robots de cada ruta (los buscadores indexan el DOM renderizado por Angular). */
interface SeoEntry {
  title: string;
  description: string;
  /** URL canónica absoluta; las rutas que no deben indexarse no la llevan y van con noindex */
  canonical?: string;
  noindex?: boolean;
}

const SITE = 'https://visordicom.es';
const HOME: SeoEntry = {
  title: 'VisorDICOM: visor DICOM online gratis, 100 % en tu navegador',
  description: 'Abre estudios DICOM (TAC, resonancia, PET, ecografía, radiografía…) desde un CD, USB o carpeta sin instalar nada y sin subir tus imágenes: todo se lee en tu navegador. Gratis y open source. Windows, Linux, Mac, Android e iOS.',
  canonical: SITE + '/'
};
const ROUTES: { [path: string]: SeoEntry } = {
  '/': HOME,
  '/reader': HOME,   // misma portada que /: canonical a la raíz para no duplicar
  '/file-loader': {
    title: 'Abrir ficheros DICOM en el navegador | VisorDICOM',
    description: 'Elige o arrastra unos ficheros DICOM y míralos al momento en tu navegador, sin subirlos a ningún sitio: CT, MR, PET, ecografía, radiografía y más.',
    canonical: SITE + '/file-loader'
  },
  '/dir-loader': {
    title: 'Abrir un CD, DVD, USB o carpeta DICOM | VisorDICOM',
    description: 'Mete el CD o el USB del hospital, elige la unidad o carpeta y VisorDICOM encuentra y organiza los estudios por paciente, estudio y serie. Todo se lee en tu navegador.',
    canonical: SITE + '/dir-loader'
  },
  '/test-screen': { title: 'VisorDICOM: pruebas', description: 'Pantalla de pruebas.', noindex: true }
};

@Injectable({ providedIn: 'root' })
export class SeoService {
  constructor(private router: Router, private titleService: Title, private meta: Meta, @Inject(DOCUMENT) private doc: Document) { }

  /** Se llama una vez desde AppComponent: a partir de ahí sigue las navegaciones. */
  public start(): void {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => this.apply((e as NavigationEnd).urlAfterRedirects));
  }

  private apply(url: string): void {
    let path = url.split('?')[0].split('#')[0].toLowerCase();
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    const entry = ROUTES[path] ?? { ...HOME, canonical: undefined, noindex: true };
    this.titleService.setTitle(entry.title);
    this.meta.updateTag({ name: 'description', content: entry.description });
    this.meta.updateTag({ name: 'robots', content: entry.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large' });
    this.meta.updateTag({ property: 'og:title', content: entry.title });
    this.meta.updateTag({ property: 'og:description', content: entry.description });
    this.meta.updateTag({ property: 'og:url', content: entry.canonical ?? SITE + '/' });
    let link = this.doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (entry.canonical) {
      if (!link) {
        link = this.doc.createElement('link');
        link.rel = 'canonical';
        this.doc.head.appendChild(link);
      }
      link.href = entry.canonical;
    } else {
      link?.remove();
    }
  }
}
