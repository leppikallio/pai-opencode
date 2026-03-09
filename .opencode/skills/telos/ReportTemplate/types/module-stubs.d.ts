declare module 'clsx' {
  export type ClassValue =
    | string
    | number
    | null
    | undefined
    | boolean
    | ClassValue[]
    | Record<string, boolean | null | undefined>;

  export function clsx(...inputs: ClassValue[]): string;
}

declare module 'tailwind-merge' {
  export function twMerge(...classLists: Array<string | null | undefined | false>): string;
}

declare module 'tailwindcss' {
  export interface Config {
    [key: string]: unknown;
  }
}
