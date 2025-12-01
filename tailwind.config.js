/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                brown: {
                    950: '#0c0a09', // Very dark (Background)
                    900: '#1c1917', // Dark (Panel)
                    800: '#292524', // Panel Highlight
                    700: '#44403c', // Border
                    600: '#57534e', // Muted Text
                    500: '#78716c',
                    400: '#a8a29e', // Secondary Text
                    300: '#d6d3d1',
                    200: '#e7e5e4', // Primary Text
                    100: '#f5f5f4',
                    50: '#fafaf9',
                },
                accent: {
                    DEFAULT: '#d97706', // Amber-600 (Gold/Orange)
                    hover: '#b45309',   // Amber-700
                    light: '#f59e0b',   // Amber-500
                }
            },
            fontFamily: {
                sans: ['DotGothic16', 'Inter', 'sans-serif'],
                mono: ['monospace'],
            }
        },
    },
    plugins: [],
}
