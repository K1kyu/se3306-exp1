import { listen, staticServer } from './servers.js';
console.log('SSG:', await listen(staticServer('lab1-ssg/dist'), Number(process.env.PORT || 8080)));
