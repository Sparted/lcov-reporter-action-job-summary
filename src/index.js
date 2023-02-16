import { promises as fs } from "fs"
import core from "@actions/core"
import { GitHub, context } from "@actions/github"
import path from "path"

import { parse } from "./lcov"
import { diff } from "./comment"
import { getChangedFiles } from "./get_changes"
import { normalisePath } from "./util"

const MAX_SUMMARY_CHARS = 1024000

async function main() {
	const token = core.getInput("github-token")
	const githubClient = new GitHub(token)
	const workingDir = core.getInput('working-directory') || './';	
	const lcovFile = path.join(workingDir, core.getInput("lcov-file") || "./coverage/lcov.info")
	const baseFile = core.getInput("lcov-base")
	const prNumber = core.getInput("pr-number");
	const shouldFilterChangedFiles =
		core.getInput("filter-changed-files").toLowerCase() === "true"
	const title = core.getInput("title")

	const raw = await fs.readFile(lcovFile, "utf-8").catch(err => null)
	if (!raw) {
		console.log(`No coverage report found at '${lcovFile}', exiting...`)
		return
	}

	const baseRaw =
		baseFile && (await fs.readFile(baseFile, "utf-8").catch(err => null))
	if (baseFile && !baseRaw) {
		console.log(`No coverage report found at '${baseFile}', ignoring...`)
	}

	const options = {
		repository: context.payload.repository.full_name,
		prefix: normalisePath(`${process.env.GITHUB_WORKSPACE}/`),
		workingDir,
	}

	const { data } = await githubClient.pulls.get({
		owner: context.repo.owner,
		repo: context.repo.repo,
		pull_number: prNumber,
	})

	core.info('Pulls data: ' + JSON.stringify(data));

	options.baseCommit = data.base.sha;
	options.commit = data.head.sha;
	options.head = data.head.ref;
	options.base = data.base.ref;
	options.title = title;
	options.shouldFilterChangedFiles = shouldFilterChangedFiles;

	core.info('Options: ' + JSON.stringify(options));

	if (shouldFilterChangedFiles) {
		options.changedFiles = await getChangedFiles(githubClient, options, context)
	}

	core.info('changedFiles: ' + JSON.stringify(options.changedFiles));

	const lcov = await parse(raw)
	const baselcov = baseRaw && (await parse(baseRaw))
	const body = diff(lcov, baselcov, options)

	const summary = body.substring(0, MAX_SUMMARY_CHARS)

	const diffSize = body.length - summary.length

	core.setOutput('comment', body || '');
}

main().catch(function(err) {
	console.log(err)
	core.setFailed(err.message)
})
