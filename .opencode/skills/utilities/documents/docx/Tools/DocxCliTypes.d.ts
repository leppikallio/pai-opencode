declare module 'commander' {
  export class Command {
    name(name: string): this;
    description(description: string): this;
    version(version: string): this;
    command(signature: string): this;
    argument(name: string, description?: string): this;
    option(flags: string, description?: string, defaultValue?: string): this;
    action<TArgs extends unknown[]>(handler: (...args: TArgs) => unknown): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    parse(argv?: string[]): this;
    outputHelp(): void;
  }
}

declare module 'docx' {
  export const AlignmentType: {
    LEFT: string;
    CENTER: string;
    RIGHT: string;
    START: string;
    JUSTIFIED: string;
    [key: string]: string;
  };

  export const HeadingLevel: {
    HEADING_1: string;
    HEADING_2: string;
    HEADING_3: string;
    HEADING_4: string;
    HEADING_5: string;
    HEADING_6: string;
    [key: string]: string;
  };
  export class StyleLevel {
    constructor(styleName: string, level: number);
  }
  export const BorderStyle: {
    SINGLE: string;
    [key: string]: string;
  };

  export const WidthType: {
    PERCENTAGE: string;
    [key: string]: string;
  };

  export interface IParagraphOptions extends Record<string, unknown> {
    children?: unknown[];
    text?: string;
  }

  export interface INumberingOptions {
    config?: Array<Record<string, unknown>>;
  }

  export class Document {
    constructor(options?: Record<string, unknown>);
  }

  export class Paragraph {
    constructor(options?: IParagraphOptions);
  }

  export class PageBreak {
    constructor(options?: Record<string, unknown>);
  }

  export class TextRun {
    constructor(options?: string | Record<string, unknown>);
  }

  export class ImageRun {
    constructor(options?: Record<string, unknown>);
  }

  export class Bookmark {
    constructor(options?: Record<string, unknown>);
  }

  export class ExternalHyperlink {
    constructor(options?: Record<string, unknown>);
  }

  export class InternalHyperlink {
    constructor(options?: Record<string, unknown>);
  }

  export class Table {
    constructor(options?: Record<string, unknown>);
  }

  export class TableCell {
    constructor(options?: Record<string, unknown>);
  }

  export class TableRow {
    constructor(options?: Record<string, unknown>);
  }

  export class TableOfContents {
    constructor(title?: string, options?: Record<string, unknown>);
  }

  export const Packer: {
    toBuffer(document: Document): Promise<Buffer>;
  };
}

declare module 'marked' {
  export interface Token {
    type: string;
    raw?: string;
    text?: string;
    tokens?: Token[];
  }

  export namespace Tokens {
    interface Heading extends Token {
      type: 'heading';
      depth: number;
      text: string;
      tokens?: Token[];
    }

    interface Paragraph extends Token {
      type: 'paragraph';
      tokens?: Token[];
    }

    interface List extends Token {
      type: 'list';
      ordered: boolean;
      items: ListItem[];
    }

    interface ListItem extends Token {
      type: 'list_item';
      tokens?: Token[];
    }

    interface Blockquote extends Token {
      type: 'blockquote';
      tokens?: Token[];
    }

    interface Code extends Token {
      type: 'code';
      text: string;
    }

    interface TableCell extends Token {
      tokens?: Token[];
      text?: string;
    }

    interface Table extends Token {
      type: 'table';
      header: TableCell[];
      rows: TableCell[][];
    }

    interface Text extends Token {
      type: 'text';
      text: string;
      tokens?: Token[];
    }

    interface Strong extends Token {
      type: 'strong';
      tokens?: Token[];
    }

    interface Em extends Token {
      type: 'em';
      tokens?: Token[];
    }

    interface Codespan extends Token {
      type: 'codespan';
      text: string;
    }

    interface Link extends Token {
      type: 'link';
      href: string;
      text: string;
      tokens?: Token[];
    }

    interface Image extends Token {
      type: 'image';
      href: string;
      text?: string;
      title?: string;
    }

    interface Escape extends Token {
      type: 'escape';
      text: string;
    }
  }

  export const marked: {
    lexer(markdown: string): Token[];
  };
}

declare module 'pizzip' {
  interface ZipFileEntry {
    asText(): string;
    asNodeBuffer(): Buffer;
  }

  export default class PizZip {
    files: Record<string, unknown>;
    constructor(data?: Buffer | string | ArrayBuffer | Uint8Array);
    file(path: string): ZipFileEntry | null;
    file(path: string, data: string | Buffer | Uint8Array): this;
    generate(options: {
      type: 'nodebuffer';
      compression?: 'DEFLATE' | 'STORE';
      compressionOptions?: { level?: number };
    }): Buffer;
  }
}
