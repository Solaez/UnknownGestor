export type AppCategory =
  | 'Programas'
  | 'Drivers'
  | 'Juegos'
  | 'Desarrollos'
  | 'Diseño'
  | 'Emuladores'
  | 'Juegos Roms'
  | 'Proyectos';

export interface DownloadEntry {
  label: string;
  url: string;
  size?: string;
  type?: 'base' | 'update' | 'dlc' | 'version' | 'required' | 'other';
}

export interface App {
  id: number;
  name: string;
  category: AppCategory;
  description: string;
  version: string;
  size: string;
  downloadUrl: string;
  downloads?: DownloadEntry[];
  instructions: string[];
  color: string;
  icon: string;
  isNew?: boolean;
  tags: string[];
  developer: string;
  publisher: string;
  rating: number;
  reviews: number;
  language: string;
  releaseDate: string;
  platform: string;
  videoId: string;
  screenshots: string[];
  coverUrl?: string;
}
