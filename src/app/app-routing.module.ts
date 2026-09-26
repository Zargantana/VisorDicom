import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TestScreenComponent } from './routes/images-reader/sub-routes/test-screen/test-screen.component';
import { ImagesReaderComponent } from './routes/images-reader/images-reader.component';
import { FileLoaderComponent } from './routes/images-reader/sub-routes/file-loader/file-loader.component';
import { DirLoaderComponent } from './routes/images-reader/sub-routes/dir-loader/dir-loader.component';

const routes: Routes = [
  { path:'reader', component: ImagesReaderComponent },
  { path:'file-loader', component: FileLoaderComponent },
  { path:'dir-loader', component: DirLoaderComponent },
  { path:'test-screen', component: TestScreenComponent },
  // La raíz es la portada (sin redirección: es la URL canónica para los buscadores); /reader es la misma pantalla
  { path: '', component: ImagesReaderComponent, pathMatch: 'full' },
  { path: '**', redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
