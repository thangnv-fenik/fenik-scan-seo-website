import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { parse } from 'csv-parse/sync';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ScraperService {
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  private REQUIRED_TITLE = ['URL', 'Title', 'Canonical', 'robots', 'h1'];

  private validateCsvHeaders(headers: string[]): void {
    const REQUIRED_TITLE = this.REQUIRED_TITLE;
    const lowerCaseHeaders = headers.map((header) => header.toLowerCase());
    const missingHeaders = REQUIRED_TITLE.filter(
      (header) => !lowerCaseHeaders.includes(header.toLowerCase()),
    );

    if (missingHeaders.length > 0) {
      throw new Error(
        `File CSV thiếu các cột bắt buộc: ${missingHeaders.join(', ')}`,
      );
    }
  }

  async processCsvFile(
    file: Express.Multer.File,
  ): Promise<Record<string, any>[]> {
    try {
      const csvContent = file.buffer.toString('utf-8');
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
      });

      this.validateCsvHeaders(Object.keys(records[0] || {}));

      const results = await Promise.all(
        records
          .filter((record) => record.URL)
          .map((record) =>
            this.checkSeoTags(record.URL, {
              meta: {
                canonical: record.Canonical,
                robots: record.robots,
                title: record.Title,
              },
              h1: record.h1,
            }),
          ),
      );

      const slackMessage = this.buildSlackMessage(records, results);
      await this.sendSlackNotification(slackMessage);
      return results;
    } catch (error) {
      await this.sendSlackNotification(
        `Lỗi khi đọc file CSV: ${error.message}`,
      );
      throw new Error(`Lỗi khi đọc file CSV: ${error.message}`);
    }
  }

  private async sendSlackNotification(message: string): Promise<void> {
    const slackWebhookUrl = this.configService.get<string>('SLACK_WEBHOOK_URL');
    if (!slackWebhookUrl) {
      console.warn('SLACK_WEBHOOK_URL không được cấu hình');
      return;
    }

    try {
      await axios.post(slackWebhookUrl, { text: message });
    } catch (error) {
      console.error(`Không thể gửi thông báo tới Slack: ${error.message}`);
    }
  }

  private compareStrings(indexWebsite: string, indexCsv: string) {
    const toWords = (str: string) =>
      str
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/,\s*/g, ',')
        .split(/[\s,]+/)
        .filter(Boolean);
    const setIndexWebsite = new Set(toWords(indexWebsite));
    const setIndexCsv = new Set(toWords(indexCsv));

    const missingWordsForIndexCSV = [...setIndexCsv].filter(
      (word) => !setIndexWebsite.has(word),
    );
    const missingWordsForIndexWebsite = [...setIndexWebsite].filter(
      (word) => !setIndexCsv.has(word),
    );

    return {
      missingWordsForIndexCSV,
      missingWordsForIndexWebsite,
      result: setIndexWebsite == setIndexCsv,
    };
  }

  private async checkSeoTags(
    url: string,
    requiredTags: {
      meta?: {
        canonical: string;
        robots: string;
        title: string;
      };
      h1?: string;
    },
  ): Promise<any> {
    try {
      const response = await firstValueFrom(this.httpService.get(url));
      const html = response.data;

      const $ = cheerio.load(html);

      const result = {
        robots: {
          found: [] as string[],
          missing: [] as string[],
          extraWords: [] as string[],
        },
        canonical: {
          found: [] as string[],
          missing: [] as string[],
        },
        h1: {
          found: [] as string[],
          missing: [] as string[],
        },
        timestamp: new Date().toLocaleString('en-US', {
          timeZone: 'Asia/Bangkok',
        }),
      };

      const metaRobots = String($('meta[name="robots"]').attr('content'));
      const metaCanonical = String($('link[rel="canonical"]').attr('href'));
      if (requiredTags.meta) {
        const resultCompare = this.compareStrings(
          metaRobots,
          requiredTags.meta.robots,
        );
        if (!resultCompare.result) {
          result.robots.missing = [...resultCompare.missingWordsForIndexCSV];
          result.robots.extraWords = [
            ...resultCompare.missingWordsForIndexWebsite,
          ];
        }
        if (requiredTags.meta.canonical.trim() != metaCanonical.trim()) {
          result.canonical.missing = [metaCanonical];
        }
      }

      // Kiểm tra thẻ <h1>
      const h1Contents = $('h1')
        .map((i, el) => $(el).text().trim())
        .get();
      if (requiredTags.h1) {
        if (
          h1Contents.some((content) =>
            content
              .toLowerCase()
              .includes(String(requiredTags.h1).toLowerCase()),
          )
        ) {
          result.h1.missing.push(requiredTags.h1);
        }
      }

      return result;
    } catch (error) {
      throw new Error(`Error fetching or parsing website: ${error.message}`);
    }
  }

  private buildSlackMessage(
    records: Record<string, any>[],
    results: Record<string, any>[],
  ): string {
    let message = '*Kết quả kiểm tra SEO từ file CSV*\n\n';

    results.forEach((result, index) => {
      const record = records[index];
      const url = result.url || record.URL;

      message += `*URL*: ${url}\n`;

      const robotsStatus =
        result.robots.missing.length === 0 &&
        result.robots.extraWords.length === 0
          ? '✅ Khớp'
          : `❌ Không khớp (Thiếu: ${result.robots.missing.join(', ') || 'không'}, Thừa: ${result.robots.extraWords.join(', ') || 'không'})`;

      const canonicalStatus =
        result.canonical.missing.length === 0
          ? '✅ Khớp'
          : `❌ Không khớp (Tìm thấy: ${result.canonical.missing.join(', ') || 'không'})`;

      const h1Status =
        result.h1.missing.length === 0
          ? '✅ Khớp'
          : `❌ Không khớp (Thiếu: ${result.h1.missing.join(', ') || 'không'})`;

      message += `- *Robots*: ${robotsStatus}\n`;
      message += `- *Canonical*: ${canonicalStatus}\n`;
      message += `- *H1*: ${h1Status}\n`;
      message += `- *Thời gian*: ${result.timestamp}\n\n`;
    });

    return message;
  }
}
