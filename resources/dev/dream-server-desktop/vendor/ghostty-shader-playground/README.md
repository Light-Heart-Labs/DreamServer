# Ghostty Shader Playground

A web-based playground for creating and testing shaders for the Ghostty terminal.


https://github.com/user-attachments/assets/32758e20-1056-42cd-b98b-abea48a776f1


## Getting Started

### Prerequisites
- Node.js (for running the development server)

### Installation
1. Clone or download this repository.
2. Install dependencies:
   ```bash
   npm install
   ```

### Running
1. Start the development server and open your browser automatically:
   ```bash
   npm start
   ```
   
   Or manually:
   ```bash
   node server.js
   ```
   Then open `http://localhost:3000` in your browser.

The server provides:
- Static file serving for HTML, JS, and GLSL files
- `/shaders-list` endpoint that returns available shader files
- WebSocket server for live reload functionality
- File watching that automatically reloads the page when shaders or other files change

## Usage

- Start the server and edit or create shaders inside the `public/shaders` directory with your favorite editor/IDE.  
  Watch them refresh automatically in the browser for faster development.
- Use the toolbar at the bottom to:
  - Change cursor type (block, vertical bar, horizontal bar)
  - Switch between AUTO, RND, and CLICK cursor movement modes
  - Pick a cursor color (mapped to uniform iCurrentCursorColor)
- Click on a canvas (in CLICK mode) to move the cursor.
- Use the dropdown on each canvas to switch shaders.
- You can use the keyboard arrows, Enter, and Backspace to move the cursor as well.



https://github.com/user-attachments/assets/7a9cc545-0708-4a42-81ee-d1a28e005f4f






## Contributing Shaders

Feel free to make a pull request to add your shader in the `shaders/` directory!  
Community contributions are welcome and appreciated.

## Developing Shaders

- Add your own shaders to the `shaders/` directory; they will automatically appear in the dropdown menus.
- The server automatically watches for file changes and reloads the page when you modify shaders or other files.

## Acknowledgements

Special thanks to [patriciogonzalezvivo](https://github.com/patriciogonzalezvivo) for his library [glslCanvas](https://github.com/patriciogonzalezvivo/glslCanvas).  
Although this project now uses a rewritten implementation to support WebGL2 and different default uniforms, his work made it possible, and several functions are directly copied from his library.

## License

MIT License. See LICENSE file for details.
