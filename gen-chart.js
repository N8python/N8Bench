import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import fs from 'fs';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import * as d3 from 'd3-scale-chromatic';

const data = JSON.parse(fs.readFileSync('./leaderboard.json', 'utf8'));

const sortedData = Object.entries(data).sort((a, b) => b[1] - a[1]).map(([a, b]) => [a, b / 30]);

const labels = sortedData.map(item => item[0]);
const scores = sortedData.map(item => item[1]);

// Calculate standard errors
const standardErrors = scores.map(p => Math.sqrt(p * (1 - p) / 300));

// Generate colors using Viridis scheme
const minScore = Math.min(...scores);
const maxScore = Math.max(...scores);
const colors = scores.map(score =>
    d3.interpolateViridis(0.2 + 0.8 * score)
);

const width = 2400;
const height = 1600;

const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: 'white',
    plugins: {
        modern: [ChartDataLabels]
    }
});

const configuration = {
    type: 'bar',
    data: {
        labels: labels,
        datasets: [{
            label: 'Scores',
            data: scores,
            backgroundColor: colors,
            borderColor: colors,
            borderWidth: 1,
            errorBars: {
                show: true,
                color: 'black',
                width: 2,
                lineWidth: 2,
                data: standardErrors
            }
        }]
    },
    options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
            title: {
                display: true,
                text: 'N8Bench Leaderboard',
                font: { size: 32, weight: 'bold' }
            },
            legend: {
                display: false
            },
            datalabels: { align: 'center', anchor: 'center', offset: 0, color: 'black', font: { size: 24, weight: 'bold' }, formatter: (value) => value.toFixed(3) }
        },
        scales: {
            x: {
                beginAtZero: true,
                max: 1,
                title: {
                    display: true,
                    text: 'Score',
                    font: { size: 24, weight: 'bold' }
                },
                ticks: {
                    font: { size: 18 }
                }
            },
            y: {
                title: {
                    display: true,
                    text: 'Model',
                    font: { size: 24, weight: 'bold' }
                },
                ticks: {
                    font: { size: 24, weight: 'bold' }
                }
            }
        },
        layout: {
            padding: {
                left: 20,
                right: 100,
                top: 20,
                bottom: 20
            }
        },
        backgroundColor: 'white'
    },
    plugins: [ChartDataLabels]
};

// Custom plugin for error bars
const errorBarPlugin = {
    id: 'errorBar',
    afterDatasetsDraw: (chart, args, options) => {
        const { ctx, data, scales } = chart;

        data.datasets.forEach(dataset => {
            if (dataset.errorBars && dataset.errorBars.show) {
                dataset.data.forEach((datapoint, index) => {
                    const yPos = scales.y.getPixelForValue(index);
                    const xPos = scales.x.getPixelForValue(datapoint);
                    const error = dataset.errorBars.data[index];

                    const errorLeftPixel = scales.x.getPixelForValue(datapoint - error);
                    const errorRightPixel = scales.x.getPixelForValue(datapoint + error);

                    ctx.save();
                    ctx.strokeStyle = dataset.errorBars.color;
                    ctx.lineWidth = dataset.errorBars.lineWidth;

                    // Draw horizontal line
                    ctx.beginPath();
                    ctx.moveTo(errorLeftPixel, yPos);
                    ctx.lineTo(errorRightPixel, yPos);
                    ctx.stroke();

                    // Draw left vertical line
                    ctx.beginPath();
                    ctx.moveTo(errorLeftPixel, yPos - 5);
                    ctx.lineTo(errorLeftPixel, yPos + 5);
                    ctx.stroke();

                    // Draw right vertical line
                    ctx.beginPath();
                    ctx.moveTo(errorRightPixel, yPos - 5);
                    ctx.lineTo(errorRightPixel, yPos + 5);
                    ctx.stroke();

                    ctx.restore();
                });
            }
        });
    }
};

configuration.plugins.push(errorBarPlugin);

async function createChart() {
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('./leaderboard.png', image);
    console.log('Chart has been saved as leaderboard.png');
}

createChart();