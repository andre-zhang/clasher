/** Shared types for festival setlist preview (client + server). */

export type SetlistPreviewSong = {
  title: string;
  count: number;
};

export type SetlistPreviewArtist = {
  artistId: string;
  name: string;
  mbid: string | null;
  setlistsFetched: number;
  songs: SetlistPreviewSong[];
  error?: string;
};

export type SetlistPreviewRow = {
  key: string;
  artistName: string;
  title: string;
  count: number;
  youtubeSearchUrl: string;
};

export type SetlistPreviewResult = {
  setlistfmConfigured: boolean;
  /** Server has Spotify app credentials (search + playlist). */
  spotifyClientConfigured: boolean;
  artists: SetlistPreviewArtist[];
  combined: SetlistPreviewRow[];
};
