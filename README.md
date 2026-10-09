# nodejs-logineolms-client

A rudimentary Node.js client for Logineo NRW (LMS only).

It wraps the Moodle web endpoints that Logineo exposes and some efficient WebScrapping (login, course overview,
course contents, assignments, folders and notifications) behind a small set of
async functions.


## Requirements

- NPM: undici and cheerio

## Quick start

```js
import moodle from "nodejs-logineolms-client";

moodle.configure({
    serverUrl: "https://your-school.logineonrw-lms.de",
    allowUnsafe: false,
    debug: false
});

const prerequisite = await moodle.getLoginPrerequisite();
const cookie = await moodle.login(
    "your-username",
    "your-password",
    prerequisite.logintoken,
    prerequisite.initCookie
);
const sesskey = await moodle.getSesskey(cookie);

const raw = await moodle.loadCourses(cookie, sesskey);
const courses = JSON.parse(raw)[0].data.courses;
```

## ReadOnly

This client is **deliberately designed as a read-only application**; it merely retrieves data from the LMS.
The ability to write or modify data (such as submitting assignments, posting in forums, or editing courses) has been intentionally omitted.
This tool should not be used for critical data; it is better suited for quickly retrieving information.
In a school setting, the system must run reliably—a requirement that my client cannot guarantee.

## License

GPL-3.0. See [LICENSE](./LICENSE).

## AI Usage
This client was designed and built almost entirely without AI.
It was used exclusively for bug fixes and translation.
_You might be able to tell from my code ^^_
