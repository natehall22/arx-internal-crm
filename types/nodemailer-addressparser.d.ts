declare module 'nodemailer/lib/addressparser' {
  export interface ParsedAddress {
    name?: string
    address?: string
    group?: ParsedAddress[]
  }
  export default function addressparser(input: string, options?: { flatten?: boolean }): ParsedAddress[]
}
