/// <reference types="vite/client" />
// eslint-disable-next-line filenames/match-regex
declare module "*.module.css" {
  const classes: { [key: string]: string };
  export default classes;
}

declare module "*.png" {
  const value: string;
  export default value;
}
