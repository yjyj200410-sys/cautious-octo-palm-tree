export type FolderReturn = { href: string; settingsOpen: boolean };
let destination: FolderReturn | undefined;

export const rememberFolderReturn = (value: FolderReturn) => { destination = value; };
export const takeFolderReturn = () => {
  const value = destination;
  destination = undefined;
  return value;
};
