// Question types matching data.json
export type QType = "fill_in_blank" | "multiple_choice_one_correct" | "multiple_choice_best_answer" | "true_false";

// Raw data from JSON
export interface RawOption {
    id: string;
    text: string;
    is_correct: boolean;
}

export interface RawQuestion {
    id: number;
    type: QType;
    type_description: string;
    question: string;
    answer?: string; // for fill_in_blank
    options?: RawOption[]; // for multiple choice and true/false
    explanation?: string;
}

export interface QuizData {
    meta: {
        title: string;
        creator: string;
        description: string;
        total_questions: number;
    };
    questions: RawQuestion[];
}

// Processed question for the app
export interface Question {
    id: string;
    type: QType;
    typeLabel: string;
    prompt: string;
    options?: string[];
    correctIndex?: number; // for multiple choice
    correctAnswer?: string; // for fill_in_blank
    explanation?: string;
}

export type Filters = {
    type: "all" | QType;
    mode: "random20" | "all" | "wrongOnly";
    shuffle: boolean;
};

export type Progress = {
    seen: Record<string, number>;
    wrong: Record<string, number>;
    correct: Record<string, number>;
    starred: Record<string, boolean>;
};
