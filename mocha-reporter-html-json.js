// var inherits = Mocha.utils.inherits;
// var Base = Mocha.reporters.Base;
// inherits(Spec, Base);


var mochaReporterHtmlJson = (function() {
    'use strict';

    /* eslint-env browser */

    /**
     * Module dependencies.
     */

    var Base = Mocha.reporters.Base;
    var utils = Mocha.utils;
    var escape = Mocha.utils.escape;

    var matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
    var escapeRe = function (str) {
        if (typeof str !== 'string') {
            throw new TypeError('Expected a string');
        }

        return str.replace(matchOperatorsRe, '\\$&');
    };

    /**
     * Save timer references to avoid Sinon interfering (see GH-237).
     */

    /* eslint-disable no-unused-vars, no-native-reassign */
    var global = window;
    var Date = global.Date;
    // var setTimeout = global.setTimeout;
    // var setInterval = global.setInterval;
    // var clearTimeout = global.clearTimeout;
    // var clearInterval = global.clearInterval;
    /* eslint-enable no-unused-vars, no-native-reassign */

    /**
     * Stats template.
     */

    var statsTemplate = '<ul id="mocha-stats">' +
        '<li class="progress"><canvas width="40" height="40"></canvas></li>' +
        '<li class="passes"><a href="javascript:void(0);">passes:</a> <em>0</em></li>' +
        '<li class="failures"><a href="javascript:void(0);">failures:</a> <em>0</em></li>' +
        '<li class="duration">duration: <em>0</em>s</li>' +
        '</ul>';

    /**
     * Initialize a new `HTML` reporter.
     *
     * @api public
     * @param {Runner} runner
     */
    function HTML(runner) {
        Base.call(this, runner);

        var self = this;
        var stats = this.stats;
        var stat = fragment(statsTemplate);
        var items = stat.getElementsByTagName('li');
        var passes = items[1].getElementsByTagName('em')[0];
        var passesLink = items[1].getElementsByTagName('a')[0];
        var failures = items[2].getElementsByTagName('em')[0];
        var failuresLink = items[2].getElementsByTagName('a')[0];
        var duration = items[3].getElementsByTagName('em')[0];
        var canvas = stat.getElementsByTagName('canvas')[0];
        var report = fragment('<ul id="mocha-report"></ul>');
        var stack = [report];
        var progress;
        var ctx;
        var root = document.getElementById('mocha');

        if (canvas.getContext) {
            var ratio = window.devicePixelRatio || 1;
            canvas.style.width = canvas.width;
            canvas.style.height = canvas.height;
            canvas.width *= ratio;
            canvas.height *= ratio;
            ctx = canvas.getContext('2d');
            ctx.scale(ratio, ratio);
            progress = new Progress();
        }

        if (!root) {
            return error('#mocha div missing, add it to your document');
        }

        // pass toggle
        on(passesLink, 'click', function(evt) {
            evt.preventDefault();
            unhide();
            var name = (/pass/).test(report.className) ? '' : ' pass';
            report.className = report.className.replace(/fail|pass/g, '') + name;
            if (report.className.trim()) {
                hideSuitesWithout('test pass');
            }
        });

        // failure toggle
        on(failuresLink, 'click', function(evt) {
            evt.preventDefault();
            unhide();
            var name = (/fail/).test(report.className) ? '' : ' fail';
            report.className = report.className.replace(/fail|pass/g, '') + name;
            if (report.className.trim()) {
                hideSuitesWithout('test fail');
            }
        });

        root.appendChild(stat);
        root.appendChild(report);

        if (progress) {
            progress.size(40);
        }

        runner.on('suite', function(suite) {
            if (suite.root) {
                return;
            }

            // suite
            var url = self.suiteURL(suite);
            var el = fragment('<li class="suite"><h1><a href="%s">%s</a></h1></li>', url, escape(suite.title));

            // container
            stack[0].appendChild(el);
            stack.unshift(document.createElement('ul'));
            el.appendChild(stack[0]);
        });

        runner.on('suite end', function(suite) {
            if (suite.root) {
                updateStats();
                return;
            }
            stack.shift();
        });

        runner.on('pass', function(test) {
            jsonOnPass (test);
            var url = self.testURL(test);
            var markup = '<li class="test pass %e"><h2>%e<span class="duration">%ems</span> ' +
                '<a href="%s" class="replay">‣</a></h2></li>';
            var el = fragment(markup, test.speed, test.title, test.duration, url);
            self.addCodeToggle(el, test.body);
            appendToStack(el);
            updateStats();
        });

        runner.on('fail', function(test) {
            jsonOnFail (test);
            var el = fragment('<li class="test fail"><h2>%e <a href="%e" class="replay">‣</a></h2></li>',
                test.title, self.testURL(test));
            var stackString; // Note: Includes leading newline
            var message = test.err.toString();

            // <=IE7 stringifies to [Object Error]. Since it can be overloaded, we
            // check for the result of the stringifying.
            if (message === '[object Error]') {
                message = test.err.message;
            }

            if (test.err.stack) {
                var indexOfMessage = test.err.stack.indexOf(test.err.message);
                if (indexOfMessage === -1) {
                    stackString = test.err.stack;
                } else {
                    stackString = test.err.stack.substr(test.err.message.length + indexOfMessage);
                }
            } else if (test.err.sourceURL && test.err.line !== undefined) {
                // Safari doesn't give you a stack. Let's at least provide a source line.
                stackString = '\n(' + test.err.sourceURL + ':' + test.err.line + ')';
            }

            stackString = stackString || '';

            if (test.err.htmlMessage && stackString) {
                el.appendChild(fragment('<div class="html-error">%s\n<pre class="error">%e</pre></div>',
                    test.err.htmlMessage, stackString));
            } else if (test.err.htmlMessage) {
                el.appendChild(fragment('<div class="html-error">%s</div>', test.err.htmlMessage));
            } else {
                el.appendChild(fragment('<pre class="error">%e%e</pre>', message, stackString));
            }

            self.addCodeToggle(el, test.body);
            appendToStack(el);
            updateStats();
        });

        runner.on('pending', function(test) {
            jsonOnPending (test);
            var el = fragment('<li class="test pass pending"><h2>%e</h2></li>', test.title);
            appendToStack(el);
            updateStats();
        });

        runner.on('test end', function(test) {
            jsonOnTestEnd (test);
        });

        runner.on ('end', function (test) {
            jsonOnEnd (test, self.stats);
        });

        function appendToStack(el) {
            // Don't call .appendChild if #mocha-report was already .shift()'ed off the stack.
            if (stack[0]) {
                stack[0].appendChild(el);
            }
        }

        function updateStats() {
            // TODO: add to stats
            var percent = stats.tests / runner.total * 100 | 0;
            if (progress) {
                progress.update(percent).draw(ctx);
            }

            // update stats
            var ms = new Date() - stats.start;
            text(passes, stats.passes);
            text(failures, stats.failures);
            text(duration, (ms / 1000).toFixed(2));
        }
    }

    /**
     * Makes a URL, preserving querystring ("search") parameters.
     *
     * @param {string} s
     * @return {string} A new URL.
     */
    function makeUrl(s) {
        var search = window.location.search;

        // Remove previous grep query parameter if present
        if (search) {
            search = search.replace(/[?&]grep=[^&\s]*/g, '').replace(/^&/, '?');
        }

        return window.location.pathname + (search ? search + '&' : '?') + 'grep=' + encodeURIComponent(escapeRe(s));
    }

    /**
     * Provide suite URL.
     *
     * @param {Object} [suite]
     */
    HTML.prototype.suiteURL = function(suite) {
        return makeUrl(suite.fullTitle());
    };

    /**
     * Provide test URL.
     *
     * @param {Object} [test]
     */
    HTML.prototype.testURL = function(test) {
        return makeUrl(test.fullTitle());
    };

    /**
     * Adds code toggle functionality for the provided test's list element.
     *
     * @param {HTMLLIElement} el
     * @param {string} contents
     */
    HTML.prototype.addCodeToggle = function(el, contents) {
        var h2 = el.getElementsByTagName('h2')[0];

        on(h2, 'click', function() {
            pre.style.display = pre.style.display === 'none' ? 'block' : 'none';
        });

        var pre = fragment('<pre><code>%e</code></pre>', utils.clean(contents));
        el.appendChild(pre);
        pre.style.display = 'none';
    };

    /**
     * Display error `msg`.
     *
     * @param {string} msg
     */
    function error(msg) {
        document.body.appendChild(fragment('<div id="mocha-error">%s</div>', msg));
    }

    /**
     * Return a DOM fragment from `html`.
     *
     * @param {string} html
     */
    function fragment(html) {
        var args = arguments;
        var div = document.createElement('div');
        var i = 1;

        div.innerHTML = html.replace(/%([se])/g, function(_, type) {
            switch (type) {
                case 's':
                    return String(args[i++]);
                case 'e':
                    return escape(args[i++]);
                    // no default
            }
        });

        return div.firstChild;
    }

    /**
     * Check for suites that do not have elements
     * with `classname`, and hide them.
     *
     * @param {text} classname
     */
    function hideSuitesWithout(classname) {
        var suites = document.getElementsByClassName('suite');
        for (var i = 0; i < suites.length; i++) {
            var els = suites[i].getElementsByClassName(classname);
            if (!els.length) {
                suites[i].className += ' hidden';
            }
        }
    }

    /**
     * Unhide .hidden suites.
     */
    function unhide() {
        var els = document.getElementsByClassName('suite hidden');
        for (var i = 0; i < els.length; ++i) {
            els[i].className = els[i].className.replace('suite hidden', 'suite');
        }
    }

    /**
     * Set an element's text contents.
     *
     * @param {HTMLElement} el
     * @param {string} contents
     */
    function text(el, contents) {
        if (el.textContent) {
            el.textContent = contents;
        } else {
            el.innerText = contents;
        }
    }

    /**
     * Listen on `event` with callback `fn`.
     */
    function on(el, event, fn) {
        if (el.addEventListener) {
            el.addEventListener(event, fn, false);
        } else {
            el.attachEvent('on' + event, fn);
        }
    }

    /**
     * Expose `Progress`.
     */

    /**
     * Initialize a new `Progress` indicator.
     */
    function Progress() {
        this.percent = 0;
        this.size(0);
        this.fontSize(11);
        this.font('helvetica, arial, sans-serif');
    }

    /**
     * Set progress size to `size`.
     *
     * @api public
     * @param {number} size
     * @return {Progress} Progress instance.
     */
    Progress.prototype.size = function(size) {
        this._size = size;
        return this;
    };

    /**
     * Set text to `text`.
     *
     * @api public
     * @param {string} text
     * @return {Progress} Progress instance.
     */
    Progress.prototype.text = function(text) {
        this._text = text;
        return this;
    };

    /**
     * Set font size to `size`.
     *
     * @api public
     * @param {number} size
     * @return {Progress} Progress instance.
     */
    Progress.prototype.fontSize = function(size) {
        this._fontSize = size;
        return this;
    };

    /**
     * Set font to `family`.
     *
     * @param {string} family
     * @return {Progress} Progress instance.
     */
    Progress.prototype.font = function(family) {
        this._font = family;
        return this;
    };

    /**
     * Update percentage to `n`.
     *
     * @param {number} n
     * @return {Progress} Progress instance.
     */
    Progress.prototype.update = function(n) {
        this.percent = n;
        return this;
    };

    /**
     * Draw on `ctx`.
     *
     * @param {CanvasRenderingContext2d} ctx
     * @return {Progress} Progress instance.
     */
    Progress.prototype.draw = function(ctx) {
        try {
            var percent = Math.min(this.percent, 100);
            var size = this._size;
            var half = size / 2;
            var x = half;
            var y = half;
            var rad = half - 1;
            var fontSize = this._fontSize;

            ctx.font = fontSize + 'px ' + this._font;

            var angle = Math.PI * 2 * (percent / 100);
            ctx.clearRect(0, 0, size, size);

            // outer circle
            ctx.strokeStyle = '#9f9f9f';
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, angle, false);
            ctx.stroke();

            // inner circle
            ctx.strokeStyle = '#eee';
            ctx.beginPath();
            ctx.arc(x, y, rad - 1, 0, angle, true);
            ctx.stroke();

            // text
            var text = this._text || (percent | 0) + '%';
            var w = ctx.measureText(text).width;

            ctx.fillText(text, x - w / 2 + 1, y + fontSize / 2 - 1);
        } catch (err) {
            // don't fail if we can't render progress
        }
        return this;
    };

    /**
     * Initialize a new `JSON` reporter.
     *
     * @api public
     * @param {Runner} runner
     */
    var self = this;
    var tests = [];
    var pending = [];
    var failures = [];
    var passes = [];

    function jsonOnTestEnd (test) {
        tests.push(test);
    }

    function jsonOnPass (test) {
        passes.push(test);
    }

    function jsonOnFail (test) {
        failures.push(test);
    }

    function jsonOnPending (test) {
        pending.push(test);
    }

    function jsonOnEnd (test, stats) {
        var obj = {
          stats: stats,
          tests: tests.map(clean),
          pending: pending.map(clean),
          failures: failures.map(clean),
          passes: passes.map(clean)
        };

        // fire event with results
        var event = new CustomEvent("json-results", { detail: obj });
        document.dispatchEvent(event);

        // console.log (JSON.stringify (obj, null, 2));
    }

    /**
     * Return a plain-object representation of `test`
     * free of cyclic properties etc.
     *
     * @api private
     * @param {Object} test
     * @return {Object}
     */
    function clean (test) {
      return {
        title: test.title,
        fullTitle: test.fullTitle(),
        duration: test.duration,
        currentRetry: test.currentRetry(),
        err: errorJSON(test.err || {})
      };
    }

    /**
     * Transform `error` into a JSON object.
     *
     * @api private
     * @param {Error} err
     * @return {Object}
     */
    function errorJSON (err) {
      var res = {};
      Object.getOwnPropertyNames(err).forEach(function (key) {
        res[key] = err[key];
      }, err);
      return res;
    }

    /**
     * Expose `HTML`.
     */
    return HTML;
})();


/* JSHINT */
/* exported mochaReporterHtmlJson */
/* globals Mocha */