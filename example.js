import moodle from "./index.js"

const debug = true;

// NEVER STORE CREDS IN CODE!
const username = "your-username";
const password = "your-password";

moodle.configure({
    serverUrl: "https://your-school.logineonrw-lms.de",
    allowUnsafe: false,
    shutup: false,
    debug: debug
});

// Gets a Login-Token and a Cookie
const prerequisite = await moodle.getLoginPrerequisite();

if (!prerequisite) {
    throw new Error("Could not fetch the login prerequisite (logintoken).");
}

const cookie = await moodle.login(
    username,
    password,
    prerequisite.logintoken,
    prerequisite.initCookie
);

if (!cookie) {
    throw new Error("Login failed");
}

// Connect the Login Cookie with a Session Key
const sesskey = await moodle.getSesskey(cookie);

if (!sesskey) {
    throw new Error("Could not read the sesskey");
}

// Ready to load Data
const data = await moodle.loadCourses(cookie, sesskey);
const json = JSON.parse(data);

if (json[0].error) {
    throw new Error(json[0].exception.message);
}

const courses = json[0].data.courses;

for (const course of courses) {
    console.log(`${course.id}: ${course.fullname}`);
}

// Example Numbers.
//console.dir(await moodle.getCourseData(cookie, "620"), { depth: null });
//console.dir(await moodle.getCourseSections(cookie, "12133"), {depth: null});
//console.dir(await moodle.getCourseModule(cookie, "71840"), {depth: null});
//console.dir(await moodle.getCourseSectionFolder(cookie, "71840"), {depth: null});
//console.dir(await moodle.getNotifications(cookie, sesskey), { depth: null });
