import type { DramaticaStructure } from "./ncp";

export type GamePhase = "LISTEN" | "SUBMIT" | "VOTE" | "PROCESS";

export type Profile = {
  id: string;
  username: string | null;
  is_admin: boolean;
};

export type Episode = {
  id: string;
  title: string;
  narrative_text: string | null;
  audio_url: string | null;
  season_num: number;
  episode_num: number;
  credited_authors?: { name: string; id: string }[] | null;
};

export type Submission = {
  id: string;
  user_id: string;
  episode_id: string;
  content_text: string;
  is_synthetic: boolean;
};

export type PathOption = {
  id: string;
  episode_id: string;
  title: string;
  description: string;
  source_submission_ids?: string[] | null;
};

export type Vote = {
  id: string;
  user_id: string;
  option_id: string;
};

export type GameState = {
  id: string;
  current_phase: GamePhase;
  current_episode_id: string | null;
  current_series_bible_id?: string | null;
  phase_expiry?: string | null;
  is_transitioning?: boolean;
  transitioning_since?: string | null;
};

export type SeriesBible = {
  id: string;
  title: string;
  genre: string;
  tone: string;
  premise: string;
  bible_json: DramaticaStructure;
  intro_audio_url?: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      episodes: {
        Row: Episode;
        Insert: Partial<Episode> & {
          title: string;
          season_num: number;
          episode_num: number;
        };
        Update: Partial<Episode>;
        Relationships: [];
      };
      submissions: {
        Row: Submission;
        Insert: Partial<Submission> & {
          user_id: string;
          episode_id: string;
          content_text: string;
        };
        Update: Partial<Submission>;
        Relationships: [];
      };
      path_options: {
        Row: PathOption;
        Insert: Partial<PathOption> & {
          episode_id: string;
          title: string;
          description: string;
        };
        Update: Partial<PathOption>;
        Relationships: [];
      };
      votes: {
        Row: Vote;
        Insert: Partial<Vote> & { user_id: string; option_id: string };
        Update: Partial<Vote>;
        Relationships: [];
      };
      game_state: {
        Row: GameState;
        Insert: Partial<GameState> & { current_phase: GamePhase; id?: string };
        Update: Partial<GameState>;
        Relationships: [];
      };
      series_bible: {
        Row: SeriesBible;
        Insert: Partial<SeriesBible> & {
          title: string;
          genre: string;
          tone: string;
          premise: string;
          bible_json: DramaticaStructure;
        };
        Update: Partial<SeriesBible>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      publish_next_episode: {
        Args: {
          p_title: string;
          p_narrative_text: string;
          p_audio_url: string | null;
          p_season_num: number;
          p_episode_num: number;
        };
        Returns: string;
      };
    };
    Enums: {
      game_phase: GamePhase;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
