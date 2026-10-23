import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** Run after Start has written the SPA shell, using only the client output. */
export function pwa(): Plugin {
	return {
		name: "student-todo-pwa",
		apply: "build",
		enforce: "post",
		buildApp: {
			order: "post",
			async handler(builder) {
				const output = builder.environments.client.config.build.outDir;
				const assets = await readdir(resolve(output, "assets"), {
					recursive: true,
					withFileTypes: true,
				});
				const urls = [
					"/_shell.html",
					"/manifest.webmanifest",
					"/favicon.svg",
					"/icons/icon-192.png",
					"/icons/icon-512.png",
					"/icons/maskable-192.png",
					"/icons/maskable-512.png",
					...assets
						.filter((entry) => entry.isFile() && !entry.name.endsWith(".map"))
						.map((entry) =>
							resolve(entry.parentPath, entry.name)
								.slice(resolve(output).length)
								.replaceAll("\\", "/"),
						),
				].sort();
				const template = await readFile(resolve(output, "sw.js"), "utf8");
				const hash = createHash("sha256").update(template);
				for (const url of urls) {
					hash.update(url).update(await readFile(resolve(output, `.${url}`)));
				}
				await writeFile(
					resolve(output, "sw.js"),
					template
						.replace("__BUILD_VERSION__", hash.digest("hex").slice(0, 16))
						.replace("[/* __PRECACHE_URLS__ */]", JSON.stringify(urls)),
				);
			},
		},
	};
}
