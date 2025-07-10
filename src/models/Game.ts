export interface Game {
  id: number;
  rank: number;
  name: string;
  bggUrl: string;
  year: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlayingTime: number | null;
  maxPlayingTime: number | null;
  weight: number | null;
  languageDependenceId: number | null;
  officialAge: number | null;
  scrapedAt: Date;
}

export interface GameWithDetails extends Game {
  languageDependence: LanguageDependence | null;
  communityPlayerRatings: CommunityPlayerRating[];
  communityAgeRatings: CommunityAgeRating[];
  categories: string[];
  mechanisms: string[];
  families: string[];
}

export interface LanguageDependence {
  id: number;
  text: string;
}

export interface CommunityPlayerRating {
  gameId: number;
  playerCount: number;
  bestPercentage: number | null;
  recommendedPercentage: number | null;
  notRecommendedPercentage: number | null;
  totalVotes: number | null;
}

export interface CommunityAgeRating {
  gameId: number;
  age: number;
  percentage: number | null;
  voteCount: number | null;
}

export interface Category {
  id: number;
  name: string;
}

export interface Mechanism {
  id: number;
  name: string;
}

export interface Family {
  id: number;
  name: string;
}

export interface GameCreateData {
  rank: number;
  name: string;
  bggUrl: string;
  year: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minPlayingTime: number | null;
  maxPlayingTime: number | null;
  weight: number | null;
  languageDependenceText: string | null;
  officialAge: number | null;
  categories: string[];
  mechanisms: string[];
  families: string[];
}

export interface CommunityData {
  playerRatings: {
    playerCount: number;
    bestPercentage: number | null;
    recommendedPercentage: number | null;
    notRecommendedPercentage: number | null;
    totalVotes: number | null;
  }[];
  ageRatings: {
    age: number;
    percentage: number | null;
    voteCount: number | null;
  }[];
}

export interface GameAnalysisFilters {
  maxAge?: number;
  minCommunityAgePercentage?: number;
  playerCount?: number;
  minPlayerCountBestPercentage?: number;
  maxWeight?: number;
  allowedLanguageDependencies?: string[];
}

export interface AnalyzedGame extends GameWithDetails {
  suitabilityScore: number;
  ageCompatible: boolean;
  playerCountRating?: number;
  languageCompatible: boolean;
  weightCompatible: boolean;
}