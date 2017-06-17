(function () {
    window['browser.js'] = {
        JSEval: function (code) {
            return eval(code);
        },

        Alert: function (message) {
            alert(message);
        },

        BeginFetch: function (descriptor) {
            var parsed = JSON.parse(descriptor);
            var url = parsed.url;

            var xhr = new XMLHttpRequest;
            xhr.open("GET", url);
            xhr.onreadystatechange = function xhrOnReadyStateChange(evt) {
                if (xhr.readyState === 4) {
                    InvokeStatic('SampleLibrary1', 'Blazor.Http', 'HttpClient', 'OnFetchCompleted', JSON.stringify({
                        asyncResultAddress: parsed.asyncResultAddress,
                        response: { statusCode: xhr.status, bodyText: xhr.response }
                    }));
                }
            };

            xhr.send(null);
        }
    };
})();

var dotNetStringDecoder;
function readDotNetString(ptrString) {
    dotNetStringDecoder = dotNetStringDecoder || new TextDecoder("utf-16le"); // Lazy-initialised because we have to wait for loading the polyfill on some browsers

    if (ptrString === 0)
        return null;
    var numBytes = Module.HEAP32[ptrString >> 2] * 2;
    var ptrChar0 = ptrString + 4;
    var subarray = Module.HEAP8.subarray(ptrChar0, ptrChar0 + numBytes);
    return dotNetStringDecoder.decode(subarray);
}

var pendingComponentDocFrags = {};
var nextPendingComponentDocFragId = 0;

//InvokeStatic('Blazor.Runtime', 'Blazor.Interop', 'Events', 'DispatchIncoming', JSON.stringify({
//    componentRef: componentRef,
//    vdomItemIndex: vdomItemIndex,
//    eventInfo: {
//        type: evt.type,
//        targetValue: isCheckbox ? targetElement.checked : targetElement.value
//    }
//}));
function InvokeStatic(assemblyName, namespace, className, methodName, stringArg) {
    return Module.ccall('JSInterop_CallDotNet', // name of C function
        'number', // return type
        ['string', 'string', 'string', 'string', 'string'], // argument types
        [assemblyName, namespace, className, methodName, stringArg]); // arguments
}

(function () {
    function ListenForReload(reloadOnConnection) {
        if (window.EventSource) {
            var source = new EventSource('/_reload');
            var sourceDidOpen;
            source.addEventListener('open', function (e) {
                sourceDidOpen = true;
                if (reloadOnConnection) {
                    location.reload();
                }
            });
            source.addEventListener('message', function (e) {
                if (e.data === 'reload') {
                    location.reload();
                }
            });
            source.addEventListener('error', function (e) {
                if (source.readyState === 0) {
                    if (sourceDidOpen || reloadOnConnection) {
                        // Connection was closed either after it was working, or while
                        // we're polling for reconnect. Don't rely on browser's default
                        // reconnection behaviour. Instead close this connection and
                        // start a new one on our desired schedule.
                        source.close();
                        setTimeout(function () {
                            ListenForReload(/* reloadOnConnection */ true);
                        }, 100);
                    }
                }
            });
        }
    }

    ListenForReload();

    function DisplayErrorPage(html) {
        var frame = document.createElement('iframe');
        document.body.appendChild(frame);
        frame.width = frame.height = '100%';
        frame.style.position = 'absolute';
        frame.style.top = 0;
        frame.frameBorder = 0;
        frame.contentDocument.write(html);
    }

    function FetchArrayBuffer(url, onload, onerror) {
        var xhr = new XMLHttpRequest;
        xhr.open("GET", url, true);
        xhr.responseType = "arraybuffer";
        xhr.onload = function xhr_onload() {
            if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                onload(xhr.response)
            } else {
                var decoder = new TextDecoder('utf-8');
                var responseBodyText = decoder.decode(new DataView(xhr.response));
                DisplayErrorPage(responseBodyText);
                onerror();
            }
        };
        xhr.onerror = onerror;
        xhr.send(null);
    }

    function StartApplication(entryPoint, referenceAssemblies) {
        var preloadAssemblies = [entryPoint].concat(referenceAssemblies).map(function (assemblyName) {
            return { assemblyName: assemblyName, url: '/_bin/' + assemblyName };
        });

        window.Module = {
            wasmBinaryFile: '/_framework/wasm/dna.wasm',
            asmjsCodeFile: '/_framework/asmjs/dna.asm.js',
            arguments: [entryPoint],
            preRun: function () {
                // Preload corlib.dll and other assemblies
                Module.readAsync = FetchArrayBuffer;
                Module.FS_createPreloadedFile('/', 'corlib.dll', '/_framework/corlib.dll', true, false);
                preloadAssemblies.forEach(function (assemblyInfo) {
                    Module.FS_createPreloadedFile('/', assemblyInfo.assemblyName, assemblyInfo.url, true, false);
                });
            },
            postRun: function () {
                InvokeStatic('SampleLibrary1', 'Blazor.Runtime.Interop', 'Startup', 'EnsureAssembliesLoaded', JSON.stringify(
                    preloadAssemblies.map(function (assemblyInfo) {
                        var name = assemblyInfo.assemblyName;
                        var isDll = name.substring(name.length - 4) === '.dll';
                        return isDll ? name.substring(0, name.length - 4) : null;
                    })
                ));
            }
        };

        var browserSupportsNativeWebAssembly = typeof WebAssembly !== 'undefined' && WebAssembly.validate;
        var dnaJsUrl = browserSupportsNativeWebAssembly
            ? '/_framework/wasm/dna.js'
            : '/_framework/asmjs/dna.js';

        if (!browserSupportsNativeWebAssembly) {
            // In the asmjs case, the initial memory structure is in a separate file we need to download
            var meminitXHR = Module['memoryInitializerRequest'] = new XMLHttpRequest();
            meminitXHR.open('GET', '/_framework/asmjs/dna.js.mem');
            meminitXHR.responseType = 'arraybuffer';
            meminitXHR.send(null);
        }

        // Can't load dna.js until Module is configured
        document.write("<script defer src=\"/_framework/emsdk-browser.js\"></script>");
        document.write("<script defer src=\"" + dnaJsUrl + "\"></script>");
    }

    // Find own <script> tag
    var allScriptElems = document.getElementsByTagName('script');
    var thisScriptElem = allScriptElems[allScriptElems.length - 1];

    // If necessary on this browser, polyfill TextDecoder
    if (typeof TextDecoder === 'undefined') {
        document.write("<script defer src=\"/_framework/encoding.js\"></script>");
    }

    // Read attributes from own <script> tag and then start the application
    var entrypoint = thisScriptElem.getAttribute('main');
    var referenceAssembliesCombined = thisScriptElem.getAttribute('references');
    var referenceAssemblies = referenceAssembliesCombined ? referenceAssembliesCombined.split(',').map(function (s) { return s.trim() }) : [];
    StartApplication(entrypoint, referenceAssemblies);
})();
