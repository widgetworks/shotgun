var validateCommandOptions = require('./validateCommandOptions'),
    shellQuote = require('shell-quote'),
    yargs = require('yargs'),
    extend = require('extend');

module.exports = exports = function (cmdStr, contextData, options) {

    var shell = this,
        asyncCmd = false;

    if (contextData) shell.context.data = contextData;

    yargs.resetOptions();

    var prompt = shell.context.getVar('prompt');

    // If no command string was supplied then write an error message.
    if (!prompt && (!cmdStr || /^[\s';"\[\]|&<>]+$|[()]/g.test(cmdStr))) {
        shell.error('Invalid input.');
        shell.emit('done', false);
        return shell;
    }
    
    

    if (cmdStr.toLowerCase() !== 'cancel') {
        // Parse the args first.
        var cmdInfo = exports.parseCmdStr.call(this, cmdStr);
        
        // If a prompt context exists then override command and options with those stored in the context...
        if (prompt) {
            cmdInfo.cmdName = prompt.cmd.toLowerCase();
            options = prompt.options;
            options[prompt.option] = cmdStr;
            shell.clearPrompt();
        }
        
        var cmd = exports.getCmd.call(this, cmdInfo, prompt, contextData, options);
        if (cmd){
            options = exports.mergeCommandOptions.call(this, cmd, cmdInfo, options, prompt);
            
            if (options.hasOwnProperty('?') || options.hasOwnProperty('help')){
                shell.execute('help', contextData, { command: cmd.name });
            } else if (validateCommandOptions(options, cmd, shell)) {
                // Coridyn: TODO: Raise a start/progress event?
                
                try {
                    if (cmd.invoke.length === 3) {
                        // This is an async command module so set asyncCmd to true.
                        asyncCmd = true;
                        // Invoke is asynchronous so we must pass in a callback that emits
                        // the done event when it is called.
                        cmd.invoke(shell, options, function (err) {
                            if (err) shell.error(err);
                            
                            // Coridyn: Emit an event indicating the command is complete.
                            exports.commandDone.call(this, shell, cmdInfo, contextData, options);
                        });
                    } else {
                        // Invoke is not asynchronous so do not pass in a callback.
                        cmd.invoke(shell, options);
                    }
                } catch (err) {
                    shell.error(err);
                }
            }
            
        } else {
            shell.log('"' + cmdInfo.cmdName + '" is not a valid command', { type: 'error' });
        }
       
    } else {
        // If prompt exists then cancel it...
        if (prompt){
            shell.log('prompt canceled', { type: 'warn' });
            shell.clearPrompt();
        }
        // ...otherwise inform user there is no active prompt.
        else {
            shell.log('there are no active prompts', { type: 'warn' });
        }
    }

    // Emit a done event if the command was not asynchronous.
    if (!asyncCmd) {
        exports.commandDone.call(this, shell, cmdInfo, contextData, options);
    }
    
    return shell;
};


/**
 * Indicate that the command was invoked and has now completed.
 * 
 * There could be an error...
 * 
 * @param  {[type]} shell [description]
 * @return {[type]}       [description]
 */
exports.commandDone = function(shell, cmdInfo, contextData, options){
    var hasNewPrompt = !!shell.context.getVar('prompt');
    shell.emit('done', hasNewPrompt); // !! ensures the value is a boolean.
    
    // 2014-08-24:
    // Raise an event indicating that the command was invoked.
    // 
    // Only raise this event when there are no more prompts.
    if (hasNewPrompt === false){
        shell.emit('commandComplete', cmdInfo, contextData, options);
    }
}


/**
 * Parse the command string into a consistent format.
 *  {
 *    cmdName: String,
 *    args: [all other properties]
 *  }
 * 
 * @return {[type]} [description]
 */
exports.parseCmdStr = function(cmdStr){
    // Parse the command string into an argument array and set the command name to the first item.
    var args = cmdStr,
        cmdName = cmdStr;
    if (cmdStr.length > 0) {
        args = shellQuote.parse(cmdStr);
        cmdName = args[0];
    }
    
    // TODO: Return something here.
    return {
        cmdName: cmdName.toLowerCase(),
        args: args
    }
}


/**
 * Get the command instance represented by the given cmdStr.
 * 
 * @param  {[type]} cmdStr [description]
 * @param  {[type]} prompt [description]
 * @return {[type]}        [description]
 */
exports.getCmd = function(cmdInfo, prompt, contextData, options){
    var shell = this;
    
    // // Parse the command string into an argument array and set the command name to the first item.
    // var args = cmdStr,
    //     cmdName = cmdStr;
    // if (cmdStr.length > 0) {
    //     args = shellQuote.parse(cmdStr);
    //     cmdName = args[0];
    // }
    
    // // If a prompt context exists then override command and options with those stored in the context...
    // if (prompt) {
    //     cmdName = prompt.cmd;
    //     options = prompt.options;
    //     options[prompt.option] = cmdStr;
    //     shell.clearPrompt();
    // }

    // Get reference to the command module by name.
    var cmd = shell.cmds[cmdInfo.cmdName];

    // If the command module exists then process it's options and invoke the module.
    if (cmd && cmd.access(shell, cmdInfo.cmdName)) {
        return cmd;
    }
    
    return undefined;
}


/**
 * Consolidate the options for the given command.
 * 
 * @param  {[type]} cmd    [description]
 * @param  {[type]} cmdInfo   [description]
 * @param  {[type]} prompt [description]
 * @return {[type]}        [description]
 */
exports.mergeCommandOptions = function(cmd, cmdInfo, options, prompt){
    // ...otherwise remove the command name from the args array and build our options object.
    if (!prompt) {
        cmdInfo.args.splice(0, 1);
        // Configure yargs based on defined command options.
        if (cmd && cmd.hasOwnProperty('options')) {
            for (var key in cmd.options) {
                if (cmd.options.hasOwnProperty(key)) {
                    var option = cmd.options[key];
                    if (option.hasOwnProperty('type'))
                        switch(option.type.toLowerCase()) {
                            case "string":
                                yargs.string(key);
                                if (option.hasOwnProperty('aliases'))
                                    yargs.string(option.aliases);
                                break;
                            case "boolean":
                                yargs.boolean(key);
                                if (option.hasOwnProperty('aliases'))
                                    yargs.boolean(option.aliases);
                        }
                }
            }
        }
        // Set options by extending the parsed user options with the manually supplied options.
        options = extend({}, yargs.parse(cmdInfo.args), options);
    }
    
    return options;
}