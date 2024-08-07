import OpenAI from "openai";
import fs from "fs";
import { parseStringPromise } from "xml2js";

const openaiAccuracyReasoning = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://openrouter.ai/api/v1/"
});
// For local evaluation, change to remote API if preferred
const openaiReasoning = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://openrouter.ai/api/v1/"
});

const NUM_ITERATIONS_PER_TASK = 1;
async function computeAccuracy(accuracyReasoningModel, reasoningModel, taskObject, TRIES = 1) {
    try {
        const messages = [
            { role: "system", content: "You are an AI that solves reasoning problems step-by-step." },
            { role: "user", content: taskObject.problem }
        ];


        const allResponses = [];
        for (let i = 0; i < TRIES; i++) {
            const response = openaiReasoning.chat.completions.create({
                messages,
                model: reasoningModel,
                temperature: 0.7
            });
            allResponses.push(response);
        }

        const responses = await Promise.all(allResponses);

        const predictions = responses.map(response => response.choices[0].message.content);

        const goldLabel = taskObject.solution;

        const messagesSimilarityCompareMessages = predictions.map(prediction => [
            { role: "system", content: "You are an AI that evaluates whether the solution to a problem followed the provided reasoning. The problem will be provided in the <problem> XML tag and the solution in the <solution> XML tag. The attempted solution will be in the <attempted-solution> XML tag. Produce an analysis of the whether the attempted solution was correct between <thinking> XML tags, and output your final judgement between <grade> XML tags. You can grade the result CORRECT, CORRECT ANSWER WRONG REASONING, WRONG ANSWER RIGHT REASONING, or WRONG. In order to receive the CORRECT grade, all steps in the attempted solution must be logically consistent and match up with the steps provided in the correct solution - or must be logically equivalent to them by the end. If only a correct answer is given, give the grade of CORRECT. If a correct answer is given but the reasoning is wrong, give CORRECT ANSWER WRONG REASONING. If an exact numerical answer appears in the gold label, a response must arrive at that answer or an equivalent form to receive a grade of CORRECT." },
            { role: "user", content: `<problem>${taskObject.problem}</problem>\n<solution>${goldLabel}</solution>\n<attempted-solution>${prediction}</attempted-solution>` }
        ]);

        const similarityResponses = await Promise.all(messagesSimilarityCompareMessages.map(messages => openaiAccuracyReasoning.chat.completions.create({
            messages,
            model: accuracyReasoningModel,
            temperature: 0.0
        })));

        const similarityPredictions = similarityResponses.map(response => response.choices[0].message.content);

        const grades = similarityPredictions.map(prediction => {
            const match = prediction.match(/<grade>([^<]+)<\/grade>/);
            return match[1];
        });
        const percentageCorrect = grades.filter(grade => grade === "CORRECT").length / TRIES;
        return {
            percentageCorrect,
            grades
        }
    } catch (e) {
        console.error(e);
        return {
            percentageCorrect: -1,
            grades: []
        }
    }

}


async function evalTask(taskNumber, models, accuracyReasoningModel) {

    const task = fs.readFileSync(`tasks/task_${taskNumber}.xml`, "utf-8");
    const taskObject = (await parseStringPromise(task, { trim: true })).task;
    taskObject.problem = taskObject.problem[0];
    taskObject.solution = taskObject.solution[0];
    const model_results = {}
    const promises = models.map(async model => {
        const TRIES = 5;
        for (let i = 0; i < TRIES; i++) {
            const { percentageCorrect, grades } = await computeAccuracy(accuracyReasoningModel, model, taskObject, NUM_ITERATIONS_PER_TASK);
            if (percentageCorrect !== -1) {
                model_results[model] = percentageCorrect;
                break;
            }
        }
        if (!model_results[model]) {
            model_results[model] = 0;
        }
    });
    await Promise.all(promises);

    return model_results;

}
const models = [
    "openai/gpt-4o-2024-08-06"
]
const finalScores = Object.fromEntries(models.map(model => [model, []]));
const addCorrespondingScores = (finalScores, model_results, c) => {
    for (const model in model_results) {
        finalScores[model].push(model_results[model] * c);
    }
}
const taskCount = 30;
const tasks = Array.from({ length: taskCount }, (_, i) => i);

for (const model of models) {
    console.time(`Computing ${model}`);
    const taskResults = await Promise.all(tasks.map(async taskNumber => evalTask(taskNumber, [model], "anthropic/claude-3.5-sonnet")));
    tasks.forEach((taskNumber, i) => {
        addCorrespondingScores(finalScores, taskResults[i], 1);
    });
    console.timeEnd(`Computing ${model}`);
}
//console.log(finalScores);

for (const model in finalScores) {
    const score = finalScores[model].reduce((a, b) => a + b, 0) / taskCount;
    // Compute standard error
    const sampleVariance = finalScores[model].reduce((acc, s) => acc + (s - score) ** 2, 0) / (taskCount - 1);
    const standardError = Math.sqrt(sampleVariance / (taskCount * NUM_ITERATIONS_PER_TASK));
    //console.log(`Standard error: ${standardError}`);
    console.log(`${model}: ${score} +/- ${standardError}`);
}