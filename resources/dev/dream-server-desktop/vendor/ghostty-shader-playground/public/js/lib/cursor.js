import { hexToRgbNormalized } from "./utils.js";
import { global } from "./global.js";

/**
 * @class Cursor
 * @description Represents a cursor that can be moved around a grid based on cell dimensions.
 */
export class Cursor {
  /**
   * @property {Object} position - Current position of the cursor.
   * @property {number} position.x - x-coordinate of the cursor position.
   * @property {number} position.y - y-coordinate of the cursor position.
   * @property {Object} cell - Dimensions of a single cell in the grid.
   * @property {number} cell.width - Width of the cell.
   * @property {number} cell.height - Height of the cell.
   * @property {Object} size - Size of the cursor.
   * @property {number} size.width - Width of the cursor.
   * @property {number} size.height - Height of the cursor.
   * @property {Array<number>} color - RGBA color value for the cursor.
   */
  position = { x: 0, y: 0 };
  cell = { width: 10, height: 20 };
  size = { width: 10, height: 20 };
  color = [0, 0, 1, 1];

  constructor() {
    this.setColor(global.config.cursorColor);
  }

  /**
   * Moves the cursor in the specified direction.
   * @param {string} direction - The direction to move the cursor. Can be "up", "down", "left", or "right".
   */
  move(direction) {
    switch (direction) {
      case "up":
        this.setPosition(this.position.x, this.position.y + this.cell.height);
        break;
      case "down":
        this.setPosition(this.position.x, this.position.y - this.cell.height);
        break;
      case "left":
        this.setPosition(this.position.x - this.cell.width, this.position.y);
        break;
      case "right":
        this.setPosition(this.position.x + this.cell.width, this.position.y);
        break;
    }
  }

  /**
   * Sets the position of the cursor to the specified coordinates.
   * @param {number} x
   * @param {number} y
   */
  setPosition(x, y) {
    this.position.x = x ?? this.position.x;
    this.position.y = y ?? this.position.y;
  }

  /**
   * Sets the size of the cursor.
   * @param {number} width
   * @param {number} height
   */
  setSize(width, height) {
    this.size.width = width;
    this.size.height = height;
  }

  /**
   * Sets the color of the cursor.
   * @param {string} hex - The hexadecimal color value to set.
   */
  setColor(hex) {
    this.color = hexToRgbNormalized(hex);
  }

  /**
   * Gets the current uniform data for the cursor.
   * @returns {Array<number>} An array containing the x position, y position, width, and height of the cursor.
   */
  getUniformData() {
    return [
      this.position.x,
      this.position.y,
      this.size.width,
      this.size.height,
    ];
  }
}
