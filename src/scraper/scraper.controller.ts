import { Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('scraper')
export class ScraperController {
  constructor(private readonly scraperService: ScraperService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadCsvFile(@UploadedFile() file: Express.Multer.File) {
    return this.scraperService.processCsvFile(file)
  }

  @Get('scan')
  startScanWebsite() {
    return this.scraperService.processDefaultCsvFile();
  }
}
