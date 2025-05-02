import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { MainMenuComponent } from './components/main-menu/main-menu.component';
import { ImagesReaderComponent } from './routes/images-reader/images-reader.component';
import { MainDisplayComponent } from './components/main-display/main-display.component';
import { TopDisplayBarComponent } from './components/top-display-bar/top-display-bar.component';
import { FileLoaderComponent } from './routes/images-reader/sub-routes/file-loader/file-loader.component';
import { TestScreenComponent } from './routes/images-reader/sub-routes/test-screen/test-screen.component';
import { DirLoaderComponent } from './routes/images-reader/sub-routes/dir-loader/dir-loader.component';
import { FileTrackerComponent } from './components/file-tracker/file-tracker.component';
import { ImagesViewerComponent } from './components/images-viewer/images-viewer.component';
import { ImageIconComponent } from './components/image-icon/image-icon.component';
import { ImagesLoaderComponent } from './components/images-loader/images-loader.component';
import { ListImageViewerComponent } from './components/images-viewer/types/list-image-viewer/list-image-viewer.component';
import { ThemeSwitcherComponent } from './components/theme-switcher/theme-switcher.component';
import { NewsBannerComponent } from './components/news/news-banner/news-banner.component';
import { NewsBoardComponent } from './components/news/news-board/news-board.component';
import { ScrollImageViewerComponent } from './components/images-viewer/types/scroll-image-viewer/scroll-image-viewer.component';
import { BasicImageViewerComponent } from './components/images-viewer/basic/basic-image-viewer/basic-image-viewer.component';
import { FindingsTableComponent } from './components/images-viewer/findings-table/findings-table/findings-table.component';
import { MailSenderComponent } from './components/mail-sender/mail-sender/mail-sender.component';
import { ProductInformationComponent } from './components/product-information/product-information.component';
import { LoginFloaterComponent } from './components/login/login-floater/login-floater.component';
import { LoginFormComponent } from './components/login/login-form/login-form.component';
import { ReactiveFormsModule } from '@angular/forms';

@NgModule({ declarations: [
        AppComponent,
        MainMenuComponent,
        ImagesReaderComponent,
        MainDisplayComponent,
        TopDisplayBarComponent,
        FileLoaderComponent,
        TestScreenComponent,
        DirLoaderComponent,
        FileTrackerComponent,
        ImagesViewerComponent,
        ImageIconComponent,
        ImagesLoaderComponent,
        ListImageViewerComponent,
        ThemeSwitcherComponent,
        NewsBannerComponent,
        NewsBoardComponent,
        ScrollImageViewerComponent,
        BasicImageViewerComponent,
        FindingsTableComponent,
        MailSenderComponent,
        ProductInformationComponent,
        LoginFloaterComponent,
        LoginFormComponent
    ],
    bootstrap: [AppComponent], 
    imports: [BrowserModule,
        AppRoutingModule,
        ReactiveFormsModule], 
    providers: [] })
export class AppModule { }
