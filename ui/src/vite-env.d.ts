/// <reference types="vite/client" />

declare module "*.svg" {
  const url: string;
  export default url;
}
