

export class Lokinet
{
    constructor(opts: any);
    localip() : Promise<string>;
    start(): Promise<undefined>;
    stop(): void;
    hostname(): Promise<string>;
    connect(port: Number, host: string, callback: any): any;
    httpAgent(options: any): any;
    httpsAgent(options: any): any;
}

export function hex_to_base32z(hex: string): string;
