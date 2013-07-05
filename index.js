var fs = require('fs'),
    path = require('path'),
    optimist = require('optimist'),
    shellQuote = require('shell-quote'),
    extend = require('node.extend'),
    CommandResponse = require('./CommandResponse');

// Define the shell object.
module.exports.Shell = function (cmdsDir) {

    // Alias 'this' so we can access in other scopes.
    var shell = this;

    // This property will store all the available command modules.
    shell.cmds = {};

    // Reads all command modules from the specified directory and adds them to shell.cmds.
    function readCommands(dir) {
        if (fs.existsSync(dir)) {
            var files = fs.readdirSync(dir);
            if (files) {
                files.forEach(function (file) {
                    var cmd = require(path.resolve(dir, file));
                    if (cmd && cmd.invoke) {
                        var cmdName = path.basename(file, '.js').toLowerCase();
                        if (!(cmdName in shell.cmds)){
                            cmd.name = cmdName.toLowerCase();
                            shell.cmds[cmdName] = cmd;
                        }
                        else
                            console.warn('"%s" was not loaded because a command with the same name was already loaded.', dir + '/' + file);
                    }
                    else
                        console.warn('"%s" is not compatible with shotgun-shell and was not loaded.', file);
                });
            }
        }
    }

    // Read in user provided commands first.
    readCommands(cmdsDir || 'cmds');
    // Read in default commands provided by shotgun second. This way the user can define commands with the same name
    // as default commands and they will automatically override the default commands.
    readCommands(path.resolve(__dirname, 'defaultCmds'));

    // The main entry point into Shotgun.
    // cmdStr - the user-provided command string, with arguments.
    // options - properties on the options object will override user-provided arguments.
    // context - this object is used to maintain state across multiple executions. Pass in res.context.
    shell.execute = function (cmdStr, context, options) {

        // Define our response object. This is the object we will return.
        var res = new CommandResponse(context);

        // If no command string was supplied then write an error message.
        if (!cmdStr)
            res.error('You must supply a value.');

        // Parse the command string into an argument array and set the command name to the first item.
        var args = cmdStr,
            cmdName = cmdStr;
        if (cmdStr.length > 0) {
            args = shellQuote.parse(cmdStr);
            cmdName = args[0];
        }

        // If a prompt context exists then override command and options with those stored in the context...
        if (context && context.prompt) {
            if (cmdStr.toLowerCase() !== 'cancel') {
                cmdName = context.prompt.cmd;
                options = context.prompt.options;
                options[context.prompt.option] = cmdStr;
                delete res.context.prompt;
            }
            else {
                res.warn('prompt canceled');
                res.context = context.prompt.previousContext;
            }
        }
        // ...otherwise remove the command name from the args array and build our options object.
        else {
            args.splice(0, 1);
            options = extend(optimist(args).argv, options);
        }

        // Get reference to the command module by name.
        var cmd = shell.cmds[cmdName.toLowerCase()];

        // If the command module exists then process it's options and invoke the module...
        if (cmd) {
            if (validateOptions(res, options, cmd))
                cmd.invoke.call(res, options, shell);
        }
        // ...if the command does not exist then check to see if a passive context exists.
        else {
            // If a passive context exists then rerun 'execute' passing in the command string stored in the context...
            if (context && context.passive && context.passive.cmdStr) {
                res = shell.execute(context.passive.cmdStr + ' ' + cmdStr, context);
            }
            // If no context exists and the user did not provide the value 'cancel' then write invalid command error.
            else if (cmdName.toLowerCase() !== 'cancel')
                res.error('"' + cmdName + '" is not a valid command.');
        }

        // Return our result object to the application.
        return res;
    };

    function validateOptions (res, options, cmd) {

        // By default it is OK to invoke the command. This can be set false at any point if options do not pass
        // validation.
        var okToInvoke = true;

        // If the command has pre-defined options then parse through them and validate against the supplied options.
        if (cmd.options) {

            var nonNamedIndex = 0;

            // Loop through the command's pre-defined options.
            for (var key in cmd.options) {

                // The option defined by the command.
                var definedOption = cmd.options[key];

                // If option has named=false, attach non-named parameters as option and remove from `options._` array.
                if (!(key in options) && definedOption.noName && options._.length > 0) {
                    options[key] = options._[nonNamedIndex];
                    options._.splice(nonNamedIndex, 1);
                }

                // If defined option was not supplied and it has aliases, check if aliases were supplied and attach option.
                if (!definedOption.noName && !(key in options) && definedOption.aliases) {
                    definedOption.aliases.forEach(function (alias) {
                        if (alias in options) {
                            options[key] = options[alias];
                            delete options[alias];
                        }
                    });
                }

                // If option was not supplied and prompt has a value other than false then prompt the user for the value.
                if (!(key in options) && definedOption.prompt) {
                    res.context.prompt = {
                        option: key,
                        cmd: cmd.name,
                        options: options
                    };
                    if (definedOption.password)
                        res.password = true;
                    if (typeof(definedOption.prompt) !== 'boolean')
                        res.log(definedOption.prompt);
                    else
                        res.log('Enter value for ' + key + '.');
                    // Return immediately without further validation.
                    return false;
                }

                // If option has default value and was not found in supplied options then assign it.
                if (definedOption.default && !(key in options))
                    options[key] = definedOption.default;

                // If defined option has a validate expression or function and the option was supplied then
                // validate the supplied option against the expression or function.
                if (definedOption.validate && (key in options)) {

                    // If defined validation is a regular expression then validate the supplied value against it.
                    if (definedOption.validate instanceof RegExp) {
                        // If value does not pass validation then do not invoke command and write error message.
                        if (!definedOption.validate.test(options[key])) {
                            okToInvoke = false;
                            res.error('invalid value for "' + key + '"');
                        }
                    }
                    // If defined validation is a function then pass the value to it.
                    else if (typeof(definedOption.validate) == 'function') {
                        try {
                            // If the validation function returns false then do not invoke the command and write
                            // error message.
                            if (!definedOption.validate(options[key])) {
                                okToInvoke = false;
                                res.error('invalid value for "' + key + '"');
                            }
                        }
                        // If the provided validation function throws an error at any point then handle it
                        // gracefully and simply fail validation.
                        catch (ex) {
                            okToInvoke = false;
                            res.error('invalid value for "' + key + '"');
                        }
                    }
                }

                // If option is required but is not found in supplied options then error.
                if (definedOption.required && !(key in options)) {
                    okToInvoke = false;
                    res.error('missing parameter "' + key + '"');
                }
            }
        }

        // If all options passed validation then okToInvoke will be true.
        return okToInvoke;
    }
};