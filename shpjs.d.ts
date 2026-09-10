declare module "shpjs" {
  export default function shp(
    input: ArrayBuffer | ArrayBufferView | string,
  ): Promise<unknown>;
}