/**
 * Type definitions for Obsidian plugins
 */
import "obsidian";

declare module "*.css" {
	const content: { [className: string]: string };
	export default content;
}
