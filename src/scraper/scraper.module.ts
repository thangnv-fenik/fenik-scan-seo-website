import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { ScraperController } from './scraper.controller';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
    }),
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    })
  ],
  providers: [ScraperService],
  controllers: [ScraperController],
})
export class ScraperModule {}
