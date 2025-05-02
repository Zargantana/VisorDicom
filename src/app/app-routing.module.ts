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
  { path: '', redirectTo: '/reader', pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
