import { Agent, request, fetch, FormData } from "undici";
import validator from "validator";
import * as cheerio from "cheerio";

let agent = null;
var config = {
    isConfigured: false,
    serverUrl: null,
    allowUnsafe: false,
    shutup: false,
    debug: false,
};

function validateServerUrl(serverUrl, noQuery) {
    if (!serverUrl) {
        console.error("validateServerUrl: Missing serverUrl");
        return false;
    }
    if (!validator.isURL(serverUrl, {
        protocols: ["http", "https"],
        require_protocol: true
    })) {
        if (config.debug) { console.error("URL is Invalid or does not include the http or https schema.") }
        return false;
    }

    const url = new URL(serverUrl);

    if (noQuery && (url.search || url.hash)) {
        if (config.debug) { console.error("URL includes Query-Parameter.") }
        return false;
    }

    return true;
}

function ensureConfigured(functionName) {
    if (!config.isConfigured) {
        throw new Error(`${functionName}: client is not configured. Call configure({ serverUrl }) first.`);
    }
}

function configure({
    serverUrl,
    allowUnsafe = false,
    shutup = false,
    debug = false
}) {
    if (!serverUrl) {
        console.error("Server address is missing");
        return false;
    }

    if (!validateServerUrl(serverUrl, true)) {
        console.error("Invalid server URL.");
        return false;
    }

    if (new URL(serverUrl).protocol === "http:") {
        console.warn("Using HTTP instead of HTTPS is not recommended.");
    }

    config = {
        isConfigured: true,
        serverUrl: serverUrl,
        allowUnsafe: allowUnsafe,
        shutup: shutup,
        debug: debug,
    }

    if (allowUnsafe) {
        console.warn("The use of an insecure connection is not recommended.");

        agent = new Agent({
            connect: {
                minVersion: "TLSv1",
                maxVersion: "TLSv1.3",
                rejectUnauthorized: false
            }
        });
    } else {
        agent = new Agent({
            connect: {
                maxVersion: "TLSv1.3"
            }
        });
    }
    if (!config.shutup) console.log("The LogineoNRW Library has been successfully configured.")
    return true;
}

async function getLoginPrerequisite() {
    ensureConfigured("getLoginPrerequisite");

    try {
        const { statusCode, body, headers } = await request(
            `${config.serverUrl}/login/index.php`,
            { dispatcher: agent }
        );

        if (statusCode < 200 || statusCode >= 400) {
            console.error(`getLoginPrerequisite: unexpected status code ${statusCode}.`);
            return null;
        }

        const html = await body.text();

        const rawCookies = headers["set-cookie"];
        const cookies = Array.isArray(rawCookies)
            ? rawCookies
            : rawCookies
                ? [rawCookies]
                : [];

        const initCookie = cookies
            .map(cookie => cookie.split(";")[0])
            .join("; ");

        const match = html.match(
            /name="logintoken"\s+value="([^"]+)"/
        );

        if (!match) {
            console.error("getLoginPrerequisite: logintoken not found in HTML.");
            return null;
        }

        return {
            logintoken: match[1],
            initCookie
        };
    } catch (error) {
        console.error("getLoginPrerequisite failed:", error);
        return null;
    }
}

async function getSesskey(cookieHeader) {
    ensureConfigured("getSesskey");

    if (!cookieHeader) {
        console.error("getSesskey: missing cookieHeader.");
        return null;
    }

    try {
        const response = await fetch(`${config.serverUrl}/my/`, {
            dispatcher: agent,
            redirect: "follow",
            headers: {
                cookie: cookieHeader
            }
        });

        const html = await response.text();

        if (!response.ok) {
            console.error(
                `getSesskey: could not load authenticated page: HTTP ${response.status}`
            );
            return null;
        }

        const finalUrl = new URL(response.url);

        if (finalUrl.pathname.endsWith("/login/index.php")) {
            console.error("getSesskey: not authenticated (redirected to login page).");
            return null;
        }

        const match =
            html.match(/"sesskey"\s*:\s*"([^"]+)"/) ||
            html.match(/name="sesskey"\s+value="([^"]+)"/);

        if (!match) {
            console.error("getSesskey: sesskey not found on authenticated page.");
            return null;
        }

        return match[1];
    } catch (error) {
        console.error("getSesskey failed:", error);
        return null;
    }
}

async function login(username, password, logintoken, initCookie) {
    ensureConfigured("login");

    if (!username || !password || !logintoken) {
        console.error("login: one of the required arguments is not given.");
        return null;
    }

    try {
        const form = new FormData();
        form.append("logintoken", logintoken);
        form.append("username", username);
        form.append("password", password);

        const { statusCode, headers } = await request(
            config.serverUrl + "/login/index.php",
            {
                method: "POST",
                dispatcher: agent,
                body: form,
                headers: {
                    "cookie": initCookie
                }
            }
        );

        if (statusCode < 200 || statusCode >= 400) {
            console.error(`login: request failed with status code ${statusCode}.`);
            return null;
        }

        const rawCookies = headers["set-cookie"];
        const cookies = Array.isArray(rawCookies)
            ? rawCookies
            : rawCookies
                ? [rawCookies]
                : [];

        const cookieHeader = cookies.map(cookie => cookie.split(";")[0]).join("; ");

        const cookiePattern =
            /^MoodleSession.*moodlesess.*logineonrwlms.*$/;

        if (!cookiePattern.test(cookieHeader)) {
            console.error("login: response does not contain a valid Moodle session cookie.");
            return null;
        }

        return cookieHeader;
    } catch (error) {
        console.error("login failed:", error);
        return null;
    }
}

async function loadCourses(cookieHeader, sessionkey) {
    ensureConfigured("loadCourses");

    if (!cookieHeader || !sessionkey) {
        console.error("loadCourses: one of the required arguments is not given.");
        return null;
    }

    try {
        const cleanSesskey = encodeURIComponent(sessionkey);
        const url = `${config.serverUrl}/lib/ajax/service.php?sesskey=${cleanSesskey}&info=core_course_get_enrolled_courses_by_timeline_classification`;

        const payload = [{
            index: 0,
            methodname: "core_course_get_enrolled_courses_by_timeline_classification",
            args: {
                offset: 0,
                limit: 0,
                classification: "all",
                sort: "fullname",
                customfieldname: "",
                customfieldvalue: "",
                requiredfields: [
                    "id", "fullname", "shortname",
                    "showcoursecategory", "showshortname",
                    "visible", "enddate"
                ]
            }
        }];

        const response = await fetch(url, {
            method: "POST",
            dispatcher: agent,
            headers: {
                "content-type": "application/json",
                "cookie": cookieHeader
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error(`loadCourses: request failed: HTTP ${response.status}`);
            return null;
        }

        if (config.debug) console.log("AJAX Endpoint URL:", url);
        return await response.text();
    } catch (error) {
        console.error("loadCourses failed:", error);
        return null;
    }
}

async function getCourseData(cookieHeader, courseID) {
    ensureConfigured("getCourseData");

    if (!cookieHeader || !courseID) {
        console.error("getCourseData: one of the required arguments is not given.");
        return null;
    }

    try {
        const response = await fetch((config.serverUrl + "/course/view.php?id=" + courseID), {
            method: "GET",
            dispatcher: agent,
            headers: {
                "cookie": cookieHeader
            }
        });

        if (!response.ok) {
            console.error(`getCourseData: request failed: HTTP ${response.status}`);
            return null;
        }

        const html = await response.text();

        const $ = cheerio.load(html);


        const courseTitel = $('.page-header-headings h1.h2.mb-0').text().trim();

        const sections = $('ul.topics[data-for="course_sectionlist"] > li.section')
            .map((i, el) => {
                const section = $(el);

                const activities = section
                    .find('ul[data-for="cmlist"] > li[data-for="cmitem"]')
                    .map((j, activity) => ({
                        id: $(activity).attr('data-id'),
                        name: $(activity)
                            .find('.activityname > a .instancename')
                            .clone()
                            .children('.accesshide')
                            .remove()
                            .end()
                            .text()
                            .trim(),
                        url: $(activity).find('.activityname > a').attr('href')
                    }))
                    .get();

                // This is the section's displayed activity count, not the number of items in activities[].
                const sectionCountText = section
                    .find('.section-summary-activities')
                    .text()
                    .trim();

                const sectionCount = parseInt(
                    sectionCountText.match(/Aktivitäten\s+(\d+)/)?.[1] ?? '0',
                    10
                );

                return {
                    id: section.attr('data-id'),
                    name: section.find('h3.sectionname > a').text().trim(),
                    sectionCount,
                    activities
                };
            })
            .get();

        return {
            titel: courseTitel,
            sections: sections,
        }
    } catch (error) {
        console.error("getCourseData failed:", error);
        return null;
    }
}

async function getCourseSections(cookieHeader, sectionID) {
    ensureConfigured("getCourseSections");

    if (!cookieHeader || !sectionID) {
        console.error("getCourseSections: one of the required arguments is not given.");
        return null;
    }

    try {
        const response = await fetch((config.serverUrl + "/course/section.php?id=" + sectionID), {
            method: "GET",
            dispatcher: agent,
            headers: {
                "cookie": cookieHeader
            }
        });

        if (!response.ok) {
            console.error(`getCourseSections: request failed: HTTP ${response.status}`);
            return null;
        }

        const html = await response.text();

        const $ = cheerio.load(html);

        const section = [];

        $("li.activity[data-for='cmitem']").each((_, element) => {
            const item = $(element);

            const id = item.attr("data-id");
            const type = [...(item.attr("class") || "").matchAll(/modtype_(\w+)/g)]
                .map(match => match[1])[0];

            const title = item
                .find(".activityname, .activity-altcontent h5")
                .first()
                .text()
                .trim();

            const url = item.find(".activityname a").attr("href") || null;

            section.push({
                id,
                type,
                title,
                url
            });
        });

        return section
    } catch (error) {
        console.error("getCourseSections failed:", error);
        return null;
    }
}


async function getCourseModule(cookieHeader, moduleID) {
    ensureConfigured("getCourseModule");

    if (!cookieHeader || !moduleID) {
        console.error("getCourseModule: one of the required arguments is not given.");
        return null;
    }

    try {
        const url = new URL("/mod/assign/view.php", config.serverUrl);
        url.searchParams.set("id", moduleID);

        const response = await fetch(url, {
            method: "GET",
            dispatcher: agent,
            headers: {
                "cookie": cookieHeader
            }
        });

        if (!response.ok) {
            console.error(
                `getCourseModule: request failed: ${response.status} ${response.statusText}`
            );
            return null;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const cleanText = (element) =>
            $(element).text().replace(/\u00a0/g, " ").trim();

        const title = cleanText(".page-header-headings h1");

        const intro = $("#intro");
        const description = intro.find(".box").first().clone();

        // File lists are excluded from the task description.
        description.find(
            [
                ".fileuploadsubmission",
                ".fileuploadsubmissiontime",
                "[id*='assign_files_tree']",
                ".attachments",
                ".files"
            ].join(",")
        ).remove();

        const tasks = description.text()
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

        function extractFiles(container) {
            return $(container)
                .find(".fileuploadsubmission")
                .map((_, element) => {
                    const item = $(element);
                    const link = item.find("a[href]").first();

                    if (!link.length) {
                        return null;
                    }

                    const date = item
                        .nextAll(".fileuploadsubmissiontime")
                        .first()
                        .text()
                        .trim();

                    return {
                        name: cleanText(link),
                        url: link.attr("href") ?? null,
                        date: date || null
                    };
                })
                .get()
                .filter(Boolean);
        }

        // Find the materials section without relying on Moodle's generated ID.
        const materialsContainer = intro
            .find("[id*='assign_files_tree'], .attachments, .files")
            .filter((_, element) =>
                $(element).find(".fileuploadsubmission").length > 0
            )
            .first();

        const materials = extractFiles(
            materialsContainer.length ? materialsContainer : intro
        ).filter(file => {
            // Submission files are outside the intro, so intro files are materials.
            return Boolean(file.url);
        });


        const status = {};
        const statusTable = $(".submissionstatustable").first();

        statusTable.find("tr").each((_, element) => {
            const row = $(element);
            const key = cleanText(row.find("th").first());

            if (!key || ["Dateiabgabe", "Abgabekommentare"].includes(key)) {
                return;
            }

            const value = cleanText(row.find("td").first());

            if (value) {
                status[key] = value;
            }
        });

        const submissions = extractFiles(
            $(".submissionstatustable")
        );

        return {
            title,
            tasks,
            materials,
            status,
            submissions
        };
    } catch (error) {
        console.error("getCourseModule failed:", error);
        return null;
    }
}

async function getCourseSectionFolder(cookieHeader, sectionFolderID) {
    ensureConfigured("getCourseSectionFolder");

    if (!cookieHeader || !sectionFolderID) {
        console.error("getCourseSectionFolder: one of the required arguments is not given.");
        return null;
    }

    try {
        const response = await fetch((config.serverUrl + "/mod/folder/view.php?id=" + sectionFolderID), {
            method: "GET",
            dispatcher: agent,
            headers: {
                "cookie": cookieHeader
            }
        });

        if (!response.ok) {
            console.error(`getCourseSectionFolder: request failed: HTTP ${response.status}`);
            return null;
        }

        const html = await response.text();

        const $ = cheerio.load(html);

        return $(".foldertree .fp-filename a[href]")
            .map((_, element) => {
                const link = $(element);
                const icon = link
                    .closest(".fp-filename-icon")
                    .find(".fp-icon img");

                return {
                    name: link.text().trim(),
                    url: link.attr("href"),
                    type: icon.attr("src")?.split("/").pop() ?? null
                };
            })
            .get();
    } catch (error) {
        console.error("getCourseSectionFolder failed:", error);
        return null;
    }
}

async function getNotifications(cookieHeader, sesskey) {
    ensureConfigured("getNotifications");

    if (!cookieHeader || !sesskey) {
        console.error("getNotifications: one of the required arguments is not given.");
        return null;
    }

    try {
        const response = await fetch(
            `${config.serverUrl}/lib/ajax/service.php?sesskey=${sesskey}&info=message_popup_get_popup_notifications`,
            {
                method: "POST",
                dispatcher: agent,
                headers: {
                    cookie: cookieHeader,
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest"
                },
                body: JSON.stringify([
                    {
                        index: 0,
                        methodname: "message_popup_get_popup_notifications",
                        args: {
                            limit: 20,
                            offset: 0,
                            useridto: "0"
                        }
                    }
                ])
            }
        );

        if (!response.ok) {
            console.error(`getNotifications: request failed: HTTP ${response.status}`);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error("getNotifications failed:", error);
        return null;
    }
}

export default {
    configure,
    getLoginPrerequisite,
    getSesskey,
    login,

    loadCourses,
    getCourseData,
    getCourseSections,
    getCourseModule,
    getCourseSectionFolder,

    getNotifications,
}
