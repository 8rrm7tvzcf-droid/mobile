// Dichiarazioni minime di sql.js (il pacchetto 1.14 non porta i tipi e non c'e' @types/sql.js).
// Solo cio' che serve a sqlJs.ts.
declare module 'sql.js' {
  export type SqlJsValue = number | string | Uint8Array | null;
  export interface SqlJsStatement {
    bind(values?: SqlJsValue[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, SqlJsValue>;
    free(): boolean;
  }
  export interface SqlJsDatabase {
    run(sql: string, params?: SqlJsValue[]): SqlJsDatabase;
    exec(sql: string): unknown[];
    prepare(sql: string): SqlJsStatement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | null) => SqlJsDatabase;
  }
  export interface InitSqlJsConfig {
    locateFile?: (file: string, prefix?: string) => string;
  }
  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
