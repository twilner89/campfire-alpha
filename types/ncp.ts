export interface DramaticaStructure {
  // THE 4 THROUGHLINES (Perspectives)
  objective_story: {
    domain: 'Universe' | 'Physics' | 'Psychology' | 'Mind';
    concern: string; // The broad area of conflict
    issue: string; // The thematic focus
    problem: string; // The specific source of conflict
    solution: string; // The specific cure
    goal: string; // What everyone is chasing
    consequence: string; // What happens if they fail
  };
  main_character: {
    name: string;
    domain: 'Universe' | 'Physics' | 'Psychology' | 'Mind';
    resolve: 'Change' | 'Steadfast';
    growth: 'Start' | 'Stop';
    approach: 'Do-er' | 'Be-er';
    crucial_flaw: string; // The internal issue (Problem)
  };
  influence_character: {
    name: string;
    domain: 'Universe' | 'Physics' | 'Psychology' | 'Mind';
    unique_ability: string; // What makes them powerful to the MC
    impact: string; // How they pressure the MC
  };
  relationship_story: {
    domain: 'Universe' | 'Physics' | 'Psychology' | 'Mind';
    dynamic: string; // e.g., "Rivals", "Siblings"
    trust_score: number; // 0-100
    catalyst: string; // What speeds up their conflict
  };

  cast?: {
    [characterName: string]: {
      role: string;
      voice_dna: string;
      key_phrases: string[];
    };
  };

  // THE DYNAMICS (Pacing & Ending)
  driver: 'Action' | 'Decision';
  limit: 'Timelock' | 'Optionlock';
  outcome: 'Success' | 'Failure';
  judgment: 'Good' | 'Bad';

  // WORLD STATE
  active_facts: string[];
  inventory: string[];
}
